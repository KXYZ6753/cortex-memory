// Worker c: who-type hit questions (text.js questionType) wrong for x1 or gates, with the
// gold email. Offline.  node .../c-who.js [sets] [maxChars]
import { questionType } from "../../text.js"
import { pool, loadTable, emails, closeEmails, anatomy, verdictRow, DEV_SETS } from "./c-lib.js"
const sets = process.argv[2] ? process.argv[2].split(",") : DEV_SETS
const maxChars = Number(process.argv[3] ?? 2500)
const store = await emails()
let n = 0
for (const s of sets) {
    const { table, keys } = loadTable(s, ["gates", "x1", "oracles"])
    for (const key of keys) {
        const r = pool.byKey.get(key)
        if (r.stratum !== "hit" || questionType(r.question) !== "who") continue
        const x = table.get("x1")?.get(key), g = table.get("gates")?.get(key)
        if (x?.correct !== 0 && g?.correct !== 0) continue
        const email = store.emailOf(r.path)
        const an = anatomy(email, r)
        n++
        console.log(`################ #${n} ${s} ${key} msgs=${an.nMsgs} ev=${an.evRegion}@${an.evSeg} x1=${x?.correct} gates=${g?.correct} or=${table.get("oracles")?.get(key)?.correct ?? "-"}`)
        console.log(`Q: ${r.question}\nGOLD: ${r.gold}\nX1: ${x?.answer}\nGATES: ${g?.answer}\n--- email\n${email.slice(0, maxChars)}${email.length > maxChars ? "\n[...]" : ""}\n`)
    }
}
closeEmails()
