// Worker p6: offline stub check (no GPU) of variants/p6-shape.js.
//   node benchmarks/premise2/explore2/tools/p6-check.js <set,set> [show]
// For every question: runs gates (det, stub generator) plain and through each shape proxy;
// checks that (1) the first context equals the stored i-det-gates contextPaths, (2) every
// answer prompt was rebuilt (none kept), including the abstention retry (the stub abstains on
// the first call of every 3rd question), (3) o4 / qadj are pure reorders (same characters,
// same multiset of lines), pad = sandwich + the filler line, (4) gold-only prompts of p6-g0
// equal oracles' prompt. `show` prints one example prompt per shape (shortest gold email).
import { join } from "node:path"
import { openBm25 } from "../../bm25.js"
import { ensureEmailStore } from "../../agent-run.js"
import { loadPool } from "../../explore/pool.js"
import { loadSet } from "../../explore/sets.js"
import { latestAnswers } from "../../explore/grade.js"
import { sandwichPrompt } from "../../explore/variants.js"
import { ABSTAIN } from "../../prompts.js"
import { VARIANTS, SHAPES, FILLER, withShape } from "../variants/p6-shape.js"
import { VARIANTS as BASE } from "../../explore/variants.js"

const dataDir = ".data/premise2"
const [setsArg, show] = process.argv.slice(2)
const pool = loadPool(dataDir)
const stored = new Map()
for (const a of latestAnswers(dataDir)) if (a.variant === "i-det-gates" && a.version === "2+cold") stored.set(`${a.set}|${a.questionKey}`, a)
const emails = await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
const bm25 = openBm25(join(dataDir, "corpus.sqlite"))
const lines = (s) => s.split("\n").sort().join("\n")
const res = { n: 0, ctxSame: 0, ctxDiff: 0, ctxNoRef: 0, kept: 0, rebuilt: 0, retries: 0, reorderOk: 0, reorderBad: 0, padOk: 0, padBad: 0, goldOk: 0, goldBad: 0, chars: { sandwich: 0, o4: 0, qadj: 0, pad: 0 } }
let example = null
for (const setName of setsArg.split(",")) {
    const set = loadSet(dataDir, setName, pool)
    for (const [i, key] of set.questionKeys.entries()) {
        const record = pool.byKey.get(key)
        const ctxFor = (log) => {
            let calls = 0
            return { emailOf: emails.emailOf, emailMap: { get: emails.emailOf }, search: async (q, k, u = null) => bm25.search(q, k, u).map((h) => h.path),
                generate: async (req) => { log.push(req.prompt); calls++; return { status: "ok", answer: i % 3 === 0 && calls === 1 ? ABSTAIN : "stub" } } }
        }
        const plainLog = []
        const plain = await BASE.gates.run(ctxFor(plainLog), record)
        const ref = stored.get(`${setName}|${key}`)
        if (!ref) res.ctxNoRef++
        else if (JSON.stringify(ref.contextPaths) === JSON.stringify(plain.contextPaths)) res.ctxSame++
        else res.ctxDiff++
        if (plainLog.length > 1) res.retries++
        for (const shape of ["o4", "qadj", "pad"]) {
            const log = []
            const out = await withShape((c, r) => BASE.gates.run(c, r), shape)(ctxFor(log), record)
            res.kept += out.p6.kept
            res.rebuilt += out.p6.rebuilt
            if (JSON.stringify(out.contextPaths) !== JSON.stringify(plain.contextPaths)) res.ctxDiff++
            log.forEach((p, j) => {
                const base = plainLog[j]
                res.chars[shape] += p.length
                if (shape === "pad") (p === base.replace("\n\nEmails:\n<<<EMAILS", `\n\n${FILLER}\n\nEmails:\n<<<EMAILS`) ? res.padOk++ : res.padBad++)
                else (p.length === base.length && lines(p) === lines(base) && p !== base ? res.reorderOk++ : res.reorderBad++)
            })
        }
        plainLog.forEach((p) => { res.chars.sandwich += p.length })
        if (record.stratum === "hit") {
            const email = emails.emailOf(record.path)
            const seen = []
            await VARIANTS["p6-g0"].run({ emailOf: emails.emailOf, generate: async (req) => { seen.push(req.prompt); return { status: "ok", answer: "x" } } }, record)
            // seen[0] is det's reset prompt
            seen[1] === sandwichPrompt(record.question, [email]) ? res.goldOk++ : res.goldBad++
            if (!example || email.length < example.email.length) example = { question: record.question, email }
        }
        res.n++
    }
}
console.log(JSON.stringify(res, null, 1))
if (show) for (const shape of Object.keys(SHAPES)) console.log(`\n===== ${shape} =====\n${SHAPES[shape](example.question, [example.email])}`)
bm25.close(); emails.close()
