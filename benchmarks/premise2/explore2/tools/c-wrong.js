// Worker c: dump wrong hit answers (x1 or gates or oracles) with gold-email anatomy and
// J1 reason. Offline.  node .../c-wrong.js [variant] [sets] > out.txt
import { pool, loadTable, emails, closeEmails, anatomy, verdictRow, DEV_SETS } from "./c-lib.js"
const [variant = "x1", setsArg] = process.argv.slice(2)
const sets = setsArg ? setsArg.split(",") : DEV_SETS
const store = await emails()
let n = 0
for (const s of sets) {
    const { table, keys } = loadTable(s, [variant, "gates", "x1", "oracles"])
    for (const key of keys) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit") continue
        const v = table.get(variant)?.get(key)
        if (!v || v.correct !== 0) continue
        const an = anatomy(store.emailOf(r.path), r)
        const j = verdictRow(r, v.answer)
        n++
        console.log(`#${n} ${s} ${key} msgs=${an.nMsgs} ev=${an.evRegion}@${an.evSeg} cov=${an.evCov} chars=${an.chars} step=${v.a.step ?? "-"} | x1=${table.get("x1")?.get(key)?.correct} gates=${table.get("gates")?.get(key)?.correct} or=${table.get("oracles")?.get(key)?.correct ?? "-"}`)
        console.log(`Q: ${r.question}\nGOLD: ${r.gold}\nANS: ${v.answer}\nJ1: ${j?.reason ?? "-"}\n`)
    }
}
closeEmails()
