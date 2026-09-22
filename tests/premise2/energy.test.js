import assert from "node:assert/strict"
import test from "node:test"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import {
    findCpuPackageSensor,
    integrateBlocks,
    parseLhmValue,
    parseNvidiaSmiLine,
    readJsonl,
    summariseEnergy,
} from "../../benchmarks/premise2/energy-integrate.js"

const here = dirname(fileURLToPath(import.meta.url))
const loggerPath = join(here, "..", "..", "benchmarks", "premise2", "energy-logger.js")

// ---------------------------------------------------------------------------
// parseLhmValue
// ---------------------------------------------------------------------------

test("parseLhmValue reads plain and locale-formatted wattages", () => {
    assert.equal(parseLhmValue("45.2 W"), 45.2)
    assert.equal(parseLhmValue("45,2 W"), 45.2)
    assert.equal(parseLhmValue("1.234,5 W"), 1234.5)
    assert.equal(parseLhmValue("1,234.5 W"), 1234.5)
    assert.equal(parseLhmValue("abc"), null)
})

// ---------------------------------------------------------------------------
// findCpuPackageSensor
// ---------------------------------------------------------------------------

function intelTree() {
    return {
        Text: "Sensor",
        Children: [
            {
                Text: "DESKTOP-BENCH",
                Children: [
                    {
                        Text: "Intel Core i9-13900K",
                        Children: [
                            {
                                Text: "Powers",
                                Children: [
                                    { Text: "CPU Package", SensorId: "/intelcpu/0/power/0", Value: "45.2 W", Min: "12.0 W", Max: "88.4 W" },
                                    { Text: "CPU Cores", SensorId: "/intelcpu/0/power/1", Value: "30.1 W", Min: "5.0 W", Max: "70.0 W" },
                                ],
                            },
                        ],
                    },
                    {
                        Text: "NVIDIA GeForce RTX 5060 Ti",
                        Children: [
                            { Text: "GPU Power", SensorId: "/nvidiagpu/0/power/0", Value: "120.5 W" },
                        ],
                    },
                    {
                        Text: "Motherboard",
                        Children: [
                            { Text: "Chipset", SensorId: "/lpc/nct6798d/0/temperature/0", Value: "35.0 C" },
                        ],
                    },
                ],
            },
        ],
    }
}

function amdTree() {
    return {
        Text: "Sensor",
        Children: [
            {
                Text: "DESKTOP-BENCH",
                Children: [
                    {
                        Text: "AMD Ryzen 9 7950X",
                        Children: [
                            {
                                Text: "Powers",
                                Children: [
                                    { Text: "Package", SensorId: "/amdcpu/0/power/0", Value: "65,3 W" },
                                    { Text: "Cores", SensorId: "/amdcpu/0/power/1", Value: "40,0 W" },
                                ],
                            },
                        ],
                    },
                    {
                        Text: "NVIDIA GeForce RTX 5060 Ti",
                        Children: [
                            { Text: "GPU Power", SensorId: "/nvidiagpu/0/power/0", Value: "110.0 W" },
                        ],
                    },
                    {
                        Text: "Motherboard",
                        Children: [
                            { Text: "Chipset", SensorId: "/lpc/nct6798d/0/temperature/0", Value: "34.0 C" },
                        ],
                    },
                ],
            },
        ],
    }
}

test("findCpuPackageSensor picks the Intel package sensor over GPU/core/motherboard distractors", () => {
    const found = findCpuPackageSensor(intelTree())
    assert.ok(found)
    assert.equal(found.sensorId, "/intelcpu/0/power/0")
    assert.equal(found.text, "CPU Package")
    assert.equal(found.value, "45.2 W")
})

test("findCpuPackageSensor picks the AMD package sensor over GPU/core/motherboard distractors", () => {
    const found = findCpuPackageSensor(amdTree())
    assert.ok(found)
    assert.equal(found.sensorId, "/amdcpu/0/power/0")
    assert.equal(found.text, "Package")
    assert.equal(found.value, "65,3 W")
})

test("findCpuPackageSensor falls back to a CPU-like ancestor with no SensorId", () => {
    const tree = {
        Text: "Sensor",
        Children: [
            {
                Text: "Intel Core i5-9400",
                Children: [
                    { Text: "Package", Value: "38.0 W" }, // no SensorId at all
                    { Text: "Cores", Value: "20.0 W" },
                ],
            },
            {
                Text: "Motherboard",
                Children: [{ Text: "Package", Value: "9999 not watts" }],
            },
        ],
    }
    const found = findCpuPackageSensor(tree)
    assert.ok(found)
    assert.equal(found.text, "Package")
    assert.equal(found.value, "38.0 W")
    assert.ok(found.path.includes("Intel Core i5-9400"))
})

test("findCpuPackageSensor returns null when nothing matches", () => {
    assert.equal(findCpuPackageSensor({ Text: "Sensor", Children: [{ Text: "GPU Power", Value: "1 W" }] }), null)
    assert.equal(findCpuPackageSensor(null), null)
})

// ---------------------------------------------------------------------------
// parseNvidiaSmiLine
// ---------------------------------------------------------------------------

test("parseNvidiaSmiLine parses a full instant+average line", () => {
    assert.deepEqual(parseNvidiaSmiLine("45.23, 44.10, 37, 2048", true), {
        watts: 45.23,
        wattsAvg: 44.10,
        util: 37,
        memMB: 2048,
    })
})

test("parseNvidiaSmiLine parses the fallback (no instant field) line", () => {
    assert.deepEqual(parseNvidiaSmiLine("44.10, 37, 2048", false), {
        watts: 44.10,
        wattsAvg: null,
        util: 37,
        memMB: 2048,
    })
})

test("parseNvidiaSmiLine treats [N/A] and bare N/A fields as null, falling back to the average when only the instant field is N/A", () => {
    // Instant is [N/A] but the average is numeric: watts falls back to the average,
    // while wattsAvg still reports the average itself.
    assert.deepEqual(parseNvidiaSmiLine("[N/A], 44.10, 37, 2048", true), {
        watts: 44.10,
        wattsAvg: 44.10,
        util: 37,
        memMB: 2048,
    })
    // A bare (unbracketed) N/A in the instant field falls back the same way.
    assert.deepEqual(parseNvidiaSmiLine("N/A, 44.10, 37, 2048", true), {
        watts: 44.10,
        wattsAvg: 44.10,
        util: 37,
        memMB: 2048,
    })
    // Both instant and average are N/A: nothing to fall back to, watts stays null.
    assert.deepEqual(parseNvidiaSmiLine("[N/A], [N/A], [N/A], [N/A]", true), {
        watts: null,
        wattsAvg: null,
        util: null,
        memMB: null,
    })
})

test("parseNvidiaSmiLine returns null for garbage or short lines", () => {
    assert.equal(parseNvidiaSmiLine("", true), null)
    assert.equal(parseNvidiaSmiLine("45.2, 37", true), null)
    assert.equal(parseNvidiaSmiLine(null, true), null)
})

// ---------------------------------------------------------------------------
// readJsonl
// ---------------------------------------------------------------------------

test("readJsonl skips unparseable lines and counts them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "energy-test-"))
    const path = join(dir, "sample.jsonl")
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, '{"a":1}\nnot json\n{"a":2}\n\n{broken\n', "utf8")
    try {
        const { records, dropped } = await readJsonl(path)
        assert.deepEqual(records, [{ a: 1 }, { a: 2 }])
        assert.equal(dropped, 2)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

// ---------------------------------------------------------------------------
// integrateBlocks
// ---------------------------------------------------------------------------

function constantGpuSamples(startMs, endMs, stepMs, watts) {
    const samples = []
    for (let t = startMs; t <= endMs; t += stepMs) samples.push({ t, src: "gpu", watts })
    return samples
}

test("integrateBlocks: a constant 100W signal sampled at 100ms over a 10s block gives ~1000J", () => {
    const samples = constantGpuSamples(0, 10_000, 100, 100)
    const markers = [
        { t: 0, kind: "block-start", blockId: "b1", model: "small", cell: "floor-small", judgeActive: false },
        { t: 10_000, kind: "block-end", blockId: "b1", model: "small", cell: "floor-small", judgeActive: false },
    ]
    const [result] = integrateBlocks({ samples, markers })
    assert.ok(result, "expected one block result")
    assert.equal(result.seconds, 10)
    assert.ok(Math.abs(result.gpuJ - 1000) < 1, `expected ~1000J, got ${result.gpuJ}`)
    assert.equal(result.cpuJ, 0)
    assert.ok(Math.abs(result.gpuMeanW - 100) < 0.01)
    assert.equal(result.counts.gpu, 101) // samples strictly inside plus both edges
})

test("integrateBlocks: edge interpolation recovers energy in a 0.25s block sampled at 1s intervals", () => {
    // Samples only at t=0 (100W) and t=1000 (200W); nothing strictly inside [500, 750].
    const samples = [
        { t: 0, src: "gpu", watts: 100 },
        { t: 1000, src: "gpu", watts: 200 },
    ]
    const markers = [
        { t: 500, kind: "block-start", blockId: "short", model: "small", cell: "floor-small" },
        { t: 750, kind: "block-end", blockId: "short", model: "small", cell: "floor-small" },
    ]
    const [result] = integrateBlocks({ samples, markers })
    assert.ok(result)
    assert.equal(result.seconds, 0.25)
    // Interpolated watts at 500ms=150, at 750ms=175 -> trapezoid = 40.625J.
    assert.ok(Math.abs(result.gpuJ - 40.625) < 0.05, `expected ~40.625J, got ${result.gpuJ}`)
    assert.equal(result.counts.gpu, 0, "no sample sits strictly inside the window")
})

test("integrateBlocks: marginal energy subtracts the idle baseline and floors at 0", () => {
    const samples = constantGpuSamples(0, 10_000, 100, 100)
    const markers = [
        { t: 0, kind: "block-start", blockId: "b1", model: "small", cell: "floor-small" },
        { t: 10_000, kind: "block-end", blockId: "b1", model: "small", cell: "floor-small" },
    ]
    const idleBaselines = { small: [{ t: -1_000, gpuW: 15, cpuW: 5 }] } // 20W idle baseline
    const [result] = integrateBlocks({ samples, markers, idleBaselines })
    assert.ok(result)
    assert.equal(result.grossJ, result.totalJ)
    // marginalJ = totalJ(~1000) - 20W * 10s = ~800J
    assert.ok(Math.abs(result.marginalJ - 800) < 1, `expected ~800J, got ${result.marginalJ}`)

    // A baseline well above the signal floors marginal energy at 0, never negative.
    const highBaseline = { small: [{ t: -1_000, gpuW: 500, cpuW: 500 }] }
    const [floored] = integrateBlocks({ samples, markers, idleBaselines: highBaseline })
    assert.equal(floored.marginalJ, 0)
})

test("integrateBlocks: judgeActive is true if any marker in the block says so", () => {
    const samples = constantGpuSamples(0, 1_000, 100, 50)
    const activeMarkers = [
        { t: 0, kind: "block-start", blockId: "j1", model: "small", cell: "oracle-small", judgeActive: false },
        { t: 1_000, kind: "block-end", blockId: "j1", model: "small", cell: "oracle-small", judgeActive: true },
    ]
    const inactiveMarkers = [
        { t: 0, kind: "block-start", blockId: "j2", model: "small", cell: "oracle-small", judgeActive: false },
        { t: 1_000, kind: "block-end", blockId: "j2", model: "small", cell: "oracle-small", judgeActive: false },
    ]
    const [active] = integrateBlocks({ samples, markers: activeMarkers })
    const [inactive] = integrateBlocks({ samples, markers: inactiveMarkers })
    assert.equal(active.judgeActive, true)
    assert.equal(inactive.judgeActive, false)
})

test("integrateBlocks: an idle-start/idle-end pair yields an idle-kind entry with its own mean watts", () => {
    const samples = constantGpuSamples(0, 5_000, 100, 20)
    const markers = [
        { t: 0, kind: "idle-start", blockId: "idle-1", model: "small" },
        { t: 5_000, kind: "idle-end", blockId: "idle-1", model: "small" },
    ]
    const [result] = integrateBlocks({ samples, markers })
    assert.ok(result)
    assert.equal(result.kind, "idle")
    assert.ok(Math.abs(result.gpuMeanW - 20) < 0.01)
    assert.equal(result.idleGpuW, result.gpuMeanW)
})

test("integrateBlocks: falls back to an idle window found in the same markers when idleBaselines omits the model", () => {
    const samples = [
        ...constantGpuSamples(0, 2_000, 100, 20), // idle period at 20W
        ...constantGpuSamples(10_000, 20_000, 100, 100), // block period at 100W
    ]
    const markers = [
        { t: 0, kind: "idle-start", blockId: "idle-1", model: "small" },
        { t: 2_000, kind: "idle-end", blockId: "idle-1", model: "small" },
        { t: 10_000, kind: "block-start", blockId: "b1", model: "small", cell: "floor-small" },
        { t: 20_000, kind: "block-end", blockId: "b1", model: "small", cell: "floor-small" },
    ]
    const results = integrateBlocks({ samples, markers })
    const block = results.find((entry) => entry.blockId === "b1")
    assert.ok(block)
    assert.ok(Math.abs(block.idleGpuW - 20) < 0.01)
    // totalJ ~= 100W * 10s = 1000J; marginal = 1000 - 20*10 = 800J
    assert.ok(Math.abs(block.marginalJ - 800) < 1, `expected ~800J, got ${block.marginalJ}`)
})

// ---------------------------------------------------------------------------
// summariseEnergy
// ---------------------------------------------------------------------------

test("summariseEnergy reports per-answer energy and a mean/CI per model x cell", () => {
    const blockResults = [
        { blockId: "b1", kind: "block", model: "small", cell: "floor-small", grossJ: 1000, marginalJ: 800 },
        { blockId: "b2", kind: "block", model: "small", cell: "floor-small", grossJ: 1100, marginalJ: 900 },
        { blockId: "idle-1", kind: "idle", model: "small", cell: null, grossJ: 100, marginalJ: null },
    ]
    const answersPerBlock = { b1: 10, b2: 10 }
    const { perBlock, byModelCell } = summariseEnergy(blockResults, answersPerBlock)

    assert.equal(perBlock.length, 2, "idle entries are not answer-bearing blocks")
    assert.equal(perBlock[0].grossJPerAnswer, 100)
    assert.equal(perBlock[0].marginalJPerAnswer, 80)

    const group = byModelCell["small|floor-small"]
    assert.ok(group)
    assert.equal(group.grossJPerAnswer.n, 2)
    assert.equal(group.grossJPerAnswer.mean, 105)
    assert.ok(group.grossJPerAnswer.ci95[0] < 105 && group.grossJPerAnswer.ci95[1] > 105)
})

// ---------------------------------------------------------------------------
// The logger itself: must survive a missing nvidia-smi binary and an
// unreachable LHM server, keep writing status lines, and shut down cleanly.
// ---------------------------------------------------------------------------

test("energy-logger runs standalone, survives missing dependencies, and exits cleanly on SIGTERM", { timeout: 15_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "energy-logger-test-"))
    const outPath = join(dir, "energy.jsonl")

    const child = spawn(process.execPath, [
        loggerPath,
        "--out", outPath,
        "--nvidia-smi", "nvidia-smi-does-not-exist-xyz",
        "--lhm-url", "http://127.0.0.1:39217/data.json",
        "--gpu-ms", "200",
        "--cpu-ms", "500",
    ], { stdio: ["ignore", "pipe", "pipe"] })

    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    let exited = null
    child.once("exit", (code, signal) => { exited = { code, signal } })

    try {
        await delay(3_000)
        assert.equal(exited, null, `logger exited early (stderr: ${stderr})`)

        const raw = await readFile(outPath, "utf8")
        const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean)
        assert.ok(lines.length > 0, "expected at least one output line")

        const records = lines.map((line) => JSON.parse(line))
        for (const record of records) {
            assert.equal(typeof record.t, "number")
            assert.equal(typeof record.wall, "string")
        }
        assert.ok(records.some((record) => record.src === "status"), "expected at least one status line")
        assert.ok(
            records.some((record) => record.src === "status" && /nvidia-smi-does-not-exist-xyz/.test(record.message)),
            "expected a status line about the missing nvidia-smi binary",
        )

        if (process.platform === "win32") {
            child.kill()
            return
        }

        child.kill("SIGTERM")
        const result = await Promise.race([
            new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
            delay(5_000).then(() => ({ timedOut: true })),
        ])
        assert.ok(!result.timedOut, "logger did not exit within 5s of SIGTERM")
        assert.equal(result.code, 0)
    } finally {
        if (exited === null) {
            try { child.kill("SIGKILL") } catch { /* already gone */ }
        }
        await rm(dir, { recursive: true, force: true })
    }
})
