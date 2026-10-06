// Worker h (round 4): anatomy of x1's unsure-commit (handover) path, joined with
// m-diag's all-five W0 probes, j1's single-email reads and j2's final answers.
//   node benchmarks/premise2/explore2/tools/h-handover.js [sets...]   (default S300-2 S300-1)
//   SHOW=1 prints wrong handover hits; writes <scratch>/h-handover.json
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { openAll } from "./a-lib.js"
import { diagRows } from "./m-lib.js"
import { judgeConfig, preGrade } from "../../judge.js"
import { verdictIndex, answerVerdictKey } from "../../explore/grade.js"

const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["S300-2", "S300-1"]
const { graded, bearing } = await openAll()
const judge = judgeConfig("j1")
const vidx = verdictIndex(".data/premise2")
const vOf = (record, text) => { if (text == null) return null; if (preGrade({ answer: text, status: "ok" })) return 0; const v = vidx.get(answerVerdictKey({ answer: text }, record, judge)); return v ? (v.verdict === "CORRECT" ? 1 : 0) : null }
const byKey = (v, set) => new Map(graded(v, set).map((i) => [i.record.questionKey, i]))
const out = []
for (const set of sets) {
    const X = byKey("x1@1+cold", set), J1 = byKey("j1@1+cold", set), J2 = byKey("j2@1+cold", set)
    const D = diagRows(set)
    const t = {}
    const add = (k, n = 1) => { t[k] = (t[k] ?? 0) + n }
    for (const [key, x] of X) {
        if (x.answer.step !== "commit-g5") continue
        const rec = x.record, ab = bearing(rec), s = rec.stratum
        const d = D.get(key)?.answer
        const w0 = (d?.log ?? []).filter((l) => l.act === "w0")
        const yes = w0.filter((l) => l.yes)
        const j1 = J1.get(key), j2 = J2.get(key)
        const firstYes = (x.answer.log ?? []).find((l) => l.act === "check" && l.yes)?.path
        const row = {
            set, key, s, q: rec.question, gold: rec.gold,
            x1: x.correct, j2: j2?.correct ?? null, j2step: j2?.answer.step, j1: j1?.correct ?? null, j1step: j1?.answer.step,
            gatesA: x.answer.gatesAnswer, gatesV: vOf(rec, x.answer.gatesAnswer), firstMean: x.answer.firstMean,
            single: j1?.answer.j?.singleAnswer ?? null, singleMean: j1?.answer.j?.singleMean ?? null, singleV: vOf(rec, j1?.answer.j?.singleAnswer),
            g5A: x.answer.answer, w0: (x.answer.contextPaths ?? d?.W0 ?? []), yesAt: x.answer.yesAt,
            probes: w0.map((l) => ({ path: l.path, yes: l.yes, yesLp: l.yesLp, ab: ab(l.path) })),
            nYes: yes.length, firstYesAb: firstYes ? ab(firstYes) : null, yesAb: yes.filter((l) => ab(l.path)).length,
            w0Ab: (d?.W0 ?? []).filter(ab).length, diagMatches: d ? (yes[0]?.path === firstYes) : null,
            extracts: d?.extracts ?? [],
        }
        out.push(row)
        add(`${s} n`); add(`${s} x1 right`, x.correct ?? 0); add(`${s} j2 right`, j2?.correct ?? 0)
        add(`${s} nYes=${Math.min(yes.length, 3)}`)
        add(`${s} firstYes AB`, row.firstYesAb ? 1 : 0)
        add(`${s} W0 has AB`, row.w0Ab > 0 ? 1 : 0)
        if (yes.length >= 2) { add(`${s} nYes>=2 & yesSet has AB`, row.yesAb > 0 ? 1 : 0); add(`${s} nYes>=2 & first not AB & later YES AB`, !row.firstYesAb && row.yesAb > 0 ? 1 : 0); add(`${s} nYes>=2 j2 right`, j2?.correct ?? 0) }
        if (yes.length === 1) add(`${s} nYes=1 j2 right`, j2?.correct ?? 0)
        if (!row.diagMatches) add(`${s} diag first YES != x1 first YES`)
        if (process.env.SHOW && s === "hit" && j2?.correct === 0) {
            console.log(`\n[${set} ${key}] j2step=${row.j2step} firstMean=${row.firstMean} singleMean=${row.singleMean} nYes=${yes.length} yesAb=${row.yesAb} firstYesAb=${row.firstYesAb}`)
            console.log(`  Q: ${rec.question}\n  G: ${rec.gold}\n  gates(${row.gatesV}): ${String(row.gatesA).slice(0, 200)}\n  single(${row.singleV}): ${String(row.single).slice(0, 200)}\n  final j2: ${String(j2?.answer.answer).slice(0, 200)}`)
            console.log(`  probes: ${row.probes.map((p) => `${p.yes ? "Y" : "n"}${p.ab ? "*" : ""}${p.yesLp}`).join(" ")}`)
        }
    }
    console.log(`\n${set}`)
    for (const k of Object.keys(t).sort()) console.log(`  ${k}: ${t[k]}`)
}
writeFileSync(process.env.SCRATCH_OUT ?? join(tmpdir(), "h-handover.json"), JSON.stringify(out))
process.exit(0)
