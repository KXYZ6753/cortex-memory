// Offline checks for benchmarks/premiseBenchmark.js — no Ollama, no Postgres, no network.
// The statistics decide the premise verdict, so a wrong McNemar would silently
// produce a wrong GO/NO_GAP call. These pin the arithmetic and the text transforms.
//
//   node tests/premiseUnits.js

import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    appendRecord,
    assertMetaCompatible,
    buildContext,
    buildPoolIndex,
    distribution,
    fnv1a32,
    makeRandom,
    mcnemarExactP,
    nextPowerOfTwo,
    parseVerdict,
    preprocessEmail,
    readJsonl,
    renderEmail,
    rogonGladen,
    splitEmail,
    summariseJudgeValidation,
    wilson,
} from "../benchmarks/premiseBenchmark.js"

const near = (actual, expected, tolerance, message) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: got ${actual}, expected ~${expected}`)

function testWilson() {
    const [low, high] = wilson(71, 100)
    near(low, 0.6146, 0.001, "wilson lower bound for 71/100")
    near(high, 0.7899, 0.001, "wilson upper bound for 71/100")

    // A perfect score must not produce an interval of zero width.
    const [perfectLow, perfectHigh] = wilson(20, 20)
    assert.ok(perfectLow > 0.8 && perfectLow < 1, `wilson lower bound for 20/20 should be inside (0.8, 1), got ${perfectLow}`)
    assert.equal(perfectHigh, 1)

    assert.deepEqual(wilson(0, 0), [null, null], "wilson with no trials returns nulls")
}

function testMcnemar() {
    // Two-sided exact binomial on the discordant pairs.
    near(mcnemarExactP(24, 5), 0.000546, 0.00002, "McNemar p for b=24 c=5")
    near(mcnemarExactP(10, 0), 0.001953, 0.00002, "McNemar p for b=10 c=0")
    assert.equal(mcnemarExactP(0, 0), 1, "no discordant pairs means no evidence")
    assert.equal(mcnemarExactP(7, 7), 1, "symmetric discordance means no evidence")
    // Order must not matter; the test is two-sided.
    assert.equal(mcnemarExactP(3, 19), mcnemarExactP(19, 3), "McNemar must be symmetric in its arguments")
    assert.ok(mcnemarExactP(9, 11) > 0.2, "a near-even split should be far from significant")
}

function testRogonGladen() {
    near(rogonGladen(0.71, 0.9322, 0.9247), 0.7407, 0.001, "Rogan-Gladen correction")
    // A perfect judge must leave the observed rate untouched.
    near(rogonGladen(0.55, 1, 1), 0.55, 1e-9, "a perfect judge needs no correction")
    // A judge no better than chance carries no information.
    assert.equal(rogonGladen(0.5, 0.5, 0.5), null, "a chance-level judge cannot be inverted")
}

function testDistribution() {
    const summary = distribution([1, 2, 3, 4, 100])
    assert.equal(summary.p50, 3)
    assert.equal(summary.max, 100)
    assert.equal(summary.total, 110)
    near(summary.mean, 22, 0.05, "distribution mean")
    assert.equal(distribution([]).total, 0, "an empty distribution must not throw")
}

function testHelpers() {
    assert.equal(nextPowerOfTwo(4600 + 160 + 256), 8192)
    assert.equal(nextPowerOfTwo(593 + 160 + 256), 1024)
    assert.equal(fnv1a32("abc"), fnv1a32("abc"), "fnv1a32 must be stable")
    assert.notEqual(fnv1a32("abc"), fnv1a32("abd"))

    const first = Array.from({ length: 5 }, makeRandom(42))
    const second = Array.from({ length: 5 }, makeRandom(42))
    assert.deepEqual(first, second, "the LCG must be reproducible from its seed")
    assert.ok(first.every((value) => value >= 0 && value < 1), "the LCG must stay in [0, 1)")
}

const email = (path, subject, body) => `Subject: ${subject}
Sender: someone@enron.com
Recipients: ['a@enron.com', 'b@enron.com', 'c@enron.com', 'd@enron.com', 'e@enron.com']
File: ${path}
=====================================
${body}`

function testEmailTransforms() {
    const raw = email("user-a/sent/1.", "Ameren", `Please review.
Sent: Thursday, December 27, 2001 1:31 PM
Cc: someone.else@enron.com
See http://example.com/very/long/link for details.

-----Original Message-----
> We have received a termination notice from Ameren.`)

    const { header, body } = splitEmail(raw)
    assert.match(header, /^Subject: Ameren/)
    assert.match(body, /Please review/)
    assert.equal(splitEmail("no separator here").header, "", "a missing separator yields an empty header")

    const processed = preprocessEmail(raw)
    assert.ok(processed.length < raw.length, "preprocessing must shrink the email")
    assert.doesNotMatch(processed, /^File:/m, "the File: line is dropped")
    assert.doesNotMatch(processed, /^Sent:/m, "quoted Sent: lines are dropped")
    assert.doesNotMatch(processed, /^Cc:/m, "quoted Cc: lines are dropped")
    assert.match(processed, /\[link\]/, "URLs collapse to [link]")
    assert.match(processed, /\(\+2 more\)/, "long recipient lists are truncated with a count")

    // The critical one: on EnronQA the answer often lives in the deepest quoted
    // message, so the quoted chain must survive preprocessing intact.
    assert.match(processed, /-----Original Message-----/, "the quoted chain marker must survive")
    assert.match(processed, /termination notice from Ameren/, "answer-bearing quoted text must survive")

    assert.equal(renderEmail(raw, "original"), raw.trim(), "the original representation is verbatim")
    assert.equal(renderEmail(raw, "preprocessed"), processed)
}

function buildWorld() {
    const rows = [
        { path: "gold/1.", email: email("gold/1.", "Ameren termination", "Ameren sent a termination notice to the counterparty.") },
        { path: "near/1.", email: email("near/1.", "Ameren scheduling", "Ameren is a counterparty identified for resuming scheduling of power.") },
        { path: "near/2.", email: email("near/2.", "Ameren contract", "The Ameren counterparty contract terms are attached.") },
        ...Array.from({ length: 20 }, (_, index) => ({
            path: `far/${index}.`,
            email: email(`far/${index}.`, `Lunch ${index}`, `Anyone free for lunch on day ${index}? Nothing to do with power trading.`),
        })),
    ]
    return {
        rows,
        emailByPath: new Map(rows.map((row) => [row.path, row.email])),
        sortedPaths: rows.map((row) => row.path).sort(),
        poolIndex: buildPoolIndex(rows),
    }
}

function testHardNegatives(world) {
    const question = "What action did Ameren take as a counterparty?"
    const negatives = world.poolIndex.hardNegatives(question, "gold/1.", 2)
    assert.equal(negatives.length, 2, "should return the requested number of negatives")
    assert.ok(!negatives.includes("gold/1."), "the gold email must never be returned as a distractor")
    // Lexically similar emails must outrank unrelated ones.
    assert.ok(negatives.every((path) => path.startsWith("near/")), `hard negatives should be the Ameren emails, got ${negatives.join(", ")}`)

    assert.deepEqual(world.poolIndex.hardNegatives("", "gold/1.", 2), [], "an empty query returns nothing rather than throwing")
}

function testDistractorDeterminism(world) {
    const record = { questionKey: "gold/1.#0", path: "gold/1.", question: "What action did Ameren take as a counterparty?" }
    const hard4 = { arm: "dist", distractorType: "hard", distractorCount: 4, representation: "original" }
    const hard9 = { arm: "dist", distractorType: "hard", distractorCount: 9, representation: "original" }
    const random4 = { arm: "dist", distractorType: "random", distractorCount: 4, representation: "original" }

    const a = buildContext(record, hard4, world)
    const b = buildContext(record, hard4, world)
    assert.deepEqual(a, b, "the same question key must yield the same context across calls")

    // Nested densities: dist4 must be a strict subset of dist9 so the dose-response
    // curve is a within-case escalation rather than two unrelated draws.
    const wide = buildContext(record, hard9, world)
    assert.ok(a.distractorPaths.every((path) => wide.distractorPaths.includes(path)), "dist4 distractors must be a subset of dist9")

    for (const context of [a, wide, buildContext(record, random4, world)]) {
        assert.ok(context.paths.includes(record.path), "the gold email must be present")
        assert.equal(context.paths.length, context.distractorPaths.length + 1, "context is gold plus its distractors")
        assert.equal(context.paths[context.goldPosition], record.path, "goldPosition must point at the gold email")
        assert.ok(!context.distractorPaths.includes(record.path), "gold must not also appear as a distractor")
        assert.equal(new Set(context.paths).size, context.paths.length, "context must not contain duplicates")
    }

    // Gold position must actually vary across cases, or a model that only reads the
    // top of the context would look robust and kill test B would return a false null.
    const positions = new Set()
    for (let index = 0; index < 40; index++) {
        positions.add(buildContext({ ...record, questionKey: `gold/1.#${index}` }, hard4, world).goldPosition)
    }
    assert.ok(positions.size >= 3, `gold position must vary across cases, saw ${[...positions].join(", ")}`)

    assert.deepEqual(buildContext(record, { arm: "floor" }, world).paths, [], "the floor arm has no emails")
    assert.deepEqual(buildContext(record, { arm: "oracle" }, world).paths, ["gold/1."], "the oracle arm has only the gold email")
}

function testParseVerdict() {
    assert.equal(parseVerdict('{"verdict":"CORRECT","reason":"matches"}').verdict, "CORRECT")
    assert.equal(parseVerdict('{"verdict":"INCORRECT","reason":"different fact"}').verdict, "INCORRECT")
    // Text fallback for a judge that ignores the schema. INCORRECT contains the
    // substring CORRECT, so the negative case must win.
    assert.equal(parseVerdict("Verdict: INCORRECT because it names the wrong party").verdict, "INCORRECT")
    assert.equal(parseVerdict("I would grade this CORRECT.").verdict, "CORRECT")
    assert.equal(parseVerdict("no idea at all"), null, "an unparseable verdict is null, not a guess")
    assert.equal(parseVerdict('{"verdict":"MAYBE"}'), null, "an out-of-enum verdict is rejected")
}

async function testJsonlRecovery() {
    const directory = await mkdtemp(join(tmpdir(), "premise-units-"))
    const path = join(directory, "answers.jsonl")

    await appendRecord(path, { type: "meta", seed: 42 })
    await appendRecord(path, { type: "answer", caseKey: "a" })
    await appendRecord(path, { type: "answer", caseKey: "b" })
    // Simulate a crash mid-append: a partial final line.
    await writeFile(path, (await readFile(path, "utf8")) + '{"type":"answer","caseK')

    const { records, droppedLines } = await readJsonl(path)
    assert.equal(droppedLines, 1, "the torn line must be counted")
    assert.equal(records.length, 3, "intact records must survive")

    // After recovery the file must be appendable again without corrupting a record.
    await appendRecord(path, { type: "answer", caseKey: "c" })
    const reread = await readJsonl(path)
    assert.equal(reread.droppedLines, 0, "the recovered file must parse cleanly")
    assert.equal(reread.records.length, 4)
    assert.equal(reread.records.at(-1).caseKey, "c")
}

function testMetaGuard() {
    const base = { seed: 42, limit: 100, poolSize: 2000, hfSplit: "test", questionField: "questions", answerPromptHash: "a", distractorSpecHash: "b", modelSmall: "s", modelLarge: "l" }
    assert.equal(assertMetaCompatible(base, { ...base }), true, "identical settings are compatible")
    assert.throws(() => assertMetaCompatible(base, { ...base, seed: 7 }), /different settings/, "a changed seed must throw")
    assert.throws(() => assertMetaCompatible(base, { ...base, answerPromptHash: "z" }), /different settings/, "a changed prompt must throw")
    // A swapped model tag is legitimate mid-run (e.g. 31b -> 12b fallback): warn, do not throw.
    assert.equal(assertMetaCompatible(base, { ...base, modelLarge: "gemma4:12b-it-qat" }), false, "a changed model tag warns rather than throwing")
}

function testJudgeValidationSummary() {
    const item = (kind, expected, verdict) => ({
        validationItem: { kind, expected }, verdict, parseFailed: false, judgeFormatMode: "json",
    })
    const summary = summariseJudgeValidation([
        ...Array.from({ length: 9 }, () => item("knownCorrectGold", "CORRECT", "CORRECT")),
        item("knownCorrectGold", "CORRECT", "INCORRECT"),
        ...Array.from({ length: 8 }, () => item("knownWrong", "INCORRECT", "INCORRECT")),
        ...Array.from({ length: 2 }, () => item("knownWrong", "INCORRECT", "CORRECT")),
    ])
    assert.equal(summary.tp, 9)
    assert.equal(summary.fn, 1)
    assert.equal(summary.tn, 8)
    assert.equal(summary.fp, 2)
    near(summary.recall, 0.9, 0.001, "judge recall")
    near(summary.specificity, 0.8, 0.001, "judge specificity")
    near(summary.falseCorrectRate, 0.2, 0.001, "judge false-correct rate")
    // recall 0.90 passes, but falseCorrectRate 0.20 exceeds the 0.15 ceiling.
    assert.equal(summary.gatePassed, false, "the gate must fail on an over-permissive judge")
    assert.equal(summary.usableForAdjustment, true)
}

const world = buildWorld()
try {
    testWilson()
    testMcnemar()
    testRogonGladen()
    testDistribution()
    testHelpers()
    testEmailTransforms()
    testHardNegatives(world)
    testDistractorDeterminism(world)
    testParseVerdict()
    await testJsonlRecovery()
    testMetaGuard()
    testJudgeValidationSummary()
    console.log("premise unit checks passed")
} finally {
    world.poolIndex.close()
}
