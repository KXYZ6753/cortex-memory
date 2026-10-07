// Worker c: offline checks of a rendering over dev-set gold emails (hits): lost content
// words, lost novel answer words, message counts vs segment.js, char growth. No GPU.
//   node .../c-check.js <render> [sets]
import { contentWords, novelAnswerWords } from "../../text.js"
import { segmentBody } from "../../segment.js"
import { splitFile } from "../../text.js"
import { renderEmail, segmentThread } from "../variants/c-render.js"
import { loadSet } from "../../explore/sets.js"
import { pool, dataDir, emails, closeEmails, DEV_SETS } from "./c-lib.js"
const [render = "thread", setsArg] = process.argv.slice(2)
const sets = setsArg ? setsArg.split(",") : DEV_SETS
const store = await emails()
let n = 0, lostAny = 0, lostNovel = 0, grow = 0, chain = 0, mine = 0, theirs = 0
const examples = []
for (const s of sets) for (const key of loadSet(dataDir, s, pool).questionKeys) {
    const r = pool.byKey.get(key)
    if (r.stratum !== "hit") continue
    const email = store.emailOf(r.path)
    const out = renderEmail(email, { render })
    const before = new Set(contentWords(email.split("\n").filter((l) => !/^File:/i.test(l)).join("\n")))
    const after = new Set(contentWords(out))
    const lost = [...before].filter((w) => !after.has(w))
    const novel = novelAnswerWords([r.gold, ...(r.alternates ?? [])], r.question).filter((w) => before.has(w) && !after.has(w))
    n++
    if (lost.length) { lostAny++; if (examples.length < 15) examples.push(`${r.path}: ${lost.slice(0, 8).join(" ")}`) }
    if (novel.length) { lostNovel++; console.log(`NOVEL-LOST ${r.path}: ${novel.join(" ")} | Q: ${r.question.slice(0, 90)}`) }
    grow += out.length / email.length
    const seg = segmentBody(splitFile(email).body).messages.length
    const own = segmentThread(email).blocks.length + 1
    if (seg > 1 || own > 1) chain++
    mine += own; theirs += seg
}
closeEmails()
console.log(`${render}: ${n} gold emails; lost any content word ${lostAny}; lost a novel answer word ${lostNovel}; mean length ratio ${(grow / n).toFixed(3)}; messages: own ${mine} vs segment.js ${theirs} (${chain} chain emails)`)
for (const e of examples) console.log("  ", e)
