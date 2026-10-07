// Worker c: print renderings of emails (by path or questionKey) for inspection. Offline.
//   node .../c-show.js <thread|clean|keys> <path|questionKey> ...
import { renderEmail, keyLines } from "../variants/c-render.js"
import { pool, emails, closeEmails } from "./c-lib.js"
const [mode, ...ids] = process.argv.slice(2)
const store = await emails()
for (const id of ids) {
    const rec = pool.byKey.get(id)
    const path = rec ? rec.path : id
    const email = store.emailOf(path)
    console.log(`===== ${mode} ${path}${rec ? `\nQ: ${rec.question}\nGOLD: ${rec.gold}` : ""}`)
    if (mode === "keys") for (const k of await keyLines(rec.question, [email], { k: 3 })) console.log(`  [${k.score.toFixed(2)}] ${k.text}`)
    else console.log(renderEmail(email, { render: mode }))
}
closeEmails()
