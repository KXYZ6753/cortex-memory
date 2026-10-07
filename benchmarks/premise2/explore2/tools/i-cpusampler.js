// Per-process CPU-time sampler for CPU energy attribution (worker i, round 5).
//   node benchmarks/premise2/explore2/tools/i-cpusampler.js --out .data/premise2/explore/i-cpu.jsonl
// One long-lived PowerShell loop; every ~1 s it writes the machine's total CPU busy % over
// the last second (Get-Counter) and the cumulative CPU seconds of every node, ollama and
// llama-server process (Get-Process). No GPU access. The package power itself comes from
// the main study's energy logger (LibreHardwareMonitor); i-energy.js combines the two:
// package power ~ a + b x busy%, and a run's CPU energy is attributed from its own
// processes' CPU seconds (runner node pid + llama-server + ollama).

import { spawn } from "node:child_process"
import { createWriteStream, mkdirSync } from "node:fs"
import { dirname } from "node:path"

const args = process.argv.slice(2)
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : ".data/premise2/explore/i-cpu.jsonl"
mkdirSync(dirname(out), { recursive: true })
const stream = createWriteStream(out, { flags: "a" })

const script = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $c = Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 1
  $u = $c.CounterSamples[0].CookedValue
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $p = Get-Process -Name node,ollama,'ollama app',llama-server | ForEach-Object { '{0}:{1}:{2}' -f $_.Id, $_.ProcessName, $_.TotalProcessorTime.TotalSeconds }
  [Console]::Out.WriteLine(('{0}|{1}|{2}' -f $t, $u, ($p -join ',')))
  [Console]::Out.Flush()
}`
const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
let carry = ""
child.stdout.setEncoding("utf8")
child.stdout.on("data", (chunk) => {
    carry += chunk
    const lines = carry.split(/\r?\n/)
    carry = lines.pop() ?? ""
    for (const line of lines) {
        const [t, u, procs] = line.split("|")
        if (!Number.isFinite(Number(t))) continue
        const list = (procs ?? "").split(",").filter(Boolean).map((p) => {
            const [pid, name, cpu] = p.split(":")
            return { pid: Number(pid), name, cpu: Number(String(cpu).replace(",", ".")) }
        })
        stream.write(JSON.stringify({ t: Number(t), util: Number(String(u).replace(",", ".")), procs: list }) + "\n")
    }
})
child.stderr.on("data", () => {})
child.on("close", (code) => { stream.write(JSON.stringify({ t: Date.now(), status: `powershell exited ${code}` }) + "\n"); process.exit(0) })
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(signal, () => { try { child.kill() } catch {} ; process.exit(0) })
