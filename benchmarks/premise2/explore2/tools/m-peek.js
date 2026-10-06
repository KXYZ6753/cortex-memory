import { openAll } from "./a-lib.js"
const { emails } = await openAll()
for (const p of process.argv.slice(2)) console.log("=====", p, "\n", emails.emailOf(p).slice(0, 1500))
process.exit(0)
