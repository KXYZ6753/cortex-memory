// Offline: J1 accuracy of stored answers (gates vs oracles vs pb3...) on dev questions
// split by BM25/CE top-1 agreement and CE margin (non-switched questions only).
import { join } from "node:path"
import { judgeConfig, preGrade } from "../../judge.js"
import { latestAnswers, verdictIndex, answerVerdictKey } from "../../explore/grade.js"
import { SCRATCH, readJsonIf, DATA_DIR } from "./r-common.js"
import { loadPool } from "../../explore/pool.js"
try { process.loadEnvFile(".env") } catch {}
const variants = (process.argv[2] ?? "gates,oracles,pbs,pb3").split(",")
const F = new Map(readJsonIf(join(SCRATCH, "r-features.json"), []).map((f) => [f.key, f]))
const CE = readJsonIf(join(SCRATCH, "r-ce.json"), {})
const pool = loadPool(DATA_DIR)
const judge = judgeConfig("j1")
const verdicts = verdictIndex(DATA_DIR)
const cat = (f) => {
    const g = f.global.slice(0, 5).map((x) => x[0])
    if (!g[0].startsWith(`${f.user}/`)) return "switched"
    const ce = (p) => CE[f.key].s[p] ?? -99
    const ceTop = [...g].sort((a, b) => ce(b) - ce(a))[0]
    const margin = ce(ceTop) - Math.max(...g.filter((p) => p !== ceTop).map(ce))
    return `agree=${ceTop === g[0]} m${margin > 3 ? ">3" : margin > 1 ? "1-3" : "<1"}`
}
const t = {}
for (const a of latestAnswers(DATA_DIR)) {
    if (!variants.includes(a.variant) || a.alias !== "small" || !F.has(a.questionKey) || !CE[a.questionKey]) continue
    if (["S300-2", "S300-3", "FULL-1"].includes(a.set)) continue
    const f = F.get(a.questionKey)
    const record = pool.byKey.get(a.questionKey)
    let c
    if (preGrade(a)) c = 0
    else { const v = verdicts.get(answerVerdictKey(a, record, judge)); if (!v) continue; c = v.verdict === "CORRECT" ? 1 : 0 }
    const k = `${f.stratum} ${cat(f)}`
    t[k] ??= {}
    t[k][a.variant] ??= { n: 0, c: 0 }
    t[k][a.variant].n++
    t[k][a.variant].c += c
}
for (const [k, v] of Object.entries(t).sort()) console.log(k.padEnd(28), Object.entries(v).map(([id, x]) => `${id} ${x.n}:${(100 * x.c / x.n).toFixed(1)}`).join("  "))
