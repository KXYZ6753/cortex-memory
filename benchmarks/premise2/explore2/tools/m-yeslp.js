// Worker m: x1's first-YES logprob by commit branch (sure / unsure) and YES truth.
import { openAll } from "./a-lib.js"
const { graded, bearing } = await openAll()
const TAUS = [-0.02, -0.05, -0.1, -0.2, -0.3, -0.5]
for (const set of ["S300-2", "S300-1", "FULL-0"]) {
    const out = {}
    for (const it of graded("x1@1+cold", set)) {
        const a = it.answer
        if (!a.step?.startsWith("commit")) continue
        const yes = (a.log ?? []).find((l) => l.act === "check" && l.yes)
        const cell = `${a.step === "commit" ? "sure" : "unsure"} ${it.record.stratum} ${bearing(it.record)(yes.path) ? "trueYES" : "falseYES"} ${it.correct ? "ok" : "bad"}`
        const c = (out[cell] ??= { n: 0, ...Object.fromEntries(TAUS.map((t) => [t, 0])) })
        c.n++
        for (const t of TAUS) if ((yes.yesLp ?? -9) < t) c[t]++
    }
    console.log(`\n== ${set}  (count with yesLp < tau: ${TAUS.join(" ")})`)
    for (const [k, c] of Object.entries(out).sort()) console.log(`  ${k.padEnd(30)} n ${String(c.n).padStart(3)} | ${TAUS.map((t) => String(c[t]).padStart(4)).join(" ")}`)
}
process.exit(0)
