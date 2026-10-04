// Offline: candidate escalation triggers for gates (FULL-0 stored answers). For each
// answered question, attribute the answer to the context email that holds most of
// its novel words, then measure how well that email matches the question (names,
// content words). A good trigger fires on wrong answers whose evidence is elsewhere.
import { openAll } from "./a-lib.js"
import { byHeaderRank } from "../../explore/variants.js"
import { contentWords, normaliseForMatch, splitFile, parseFileHeader } from "../../text.js"

const target = process.argv[2] ?? "gates@1+cold"
const setName = process.argv[3] ?? "FULL-0"
const { graded, emails, bearing, missShare } = await openAll()
const items = graded(target, setName).filter((i) => i.correct !== null && !i.abstain)
const GENERIC = new Set("email emails message sent sender recipient recipients according mentioned mention mentions provided provide specific main reason name names date time following regarding question ask asked asks does what which subject attached attachment".split(" "))
// Proper-name-like tokens of the question: capitalised words not at sentence start.
export function questionNames(question) {
    const words = question.replace(/[?.,"“”()]/g, " ").split(/\s+/).filter(Boolean)
    const out = new Set()
    words.forEach((word, index) => {
        const bare = word.replace(/'s$/i, "")
        if (index > 0 && /^[A-Z][a-zA-Z\-]+$/.test(bare) && !GENERIC.has(bare.toLowerCase()) && !/^(What|Which|Who|When|Where|Why|How|According|In|On|The|A|An|Is|Are|Did|Does|Was|Were|To|From|For|Of|And|Or)$/.test(bare)) out.add(bare.toLowerCase())
    })
    return [...out]
}
for (const item of items) {
    const { record, answer } = item
    const global = record.lists.global.slice(0, 5)
    const mailbox = byHeaderRank(record.question, record.lists.user.slice(0, 20), emails.emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const contexts = switched ? [mailbox, global] : [global, mailbox]
    const final = contexts[(answer.used ?? 1) - 1]
    const qWords = new Set(contentWords(record.question))
    const aWords = contentWords(answer.answer).filter((w) => !qWords.has(w))
    const scored = final.map((path) => {
        const lower = normaliseForMatch(emails.emailOf(path))
        return { path, lower, a: aWords.length ? aWords.filter((w) => lower.includes(w)).length / aWords.length : 0 }
    }).sort((x, y) => y.a - x.a)
    const top = scored[0]
    item.attrBearing = bearing(record)(top.path)
    item.attrShare = top.a
    const names = questionNames(record.question)
    item.names = names
    item.nameCov = names.length ? names.filter((n) => top.lower.includes(n)).length / names.length : 1
    const qw = [...qWords].filter((w) => !GENERIC.has(w))
    item.qCov = qw.length ? qw.filter((w) => top.lower.includes(w)).length / qw.length : 1
    item.ownMailbox = top.path.startsWith(`${record.user}/`)
    item.u20 = record.lists.user.some(bearing(record)) && !contexts.flat().some(bearing(record))
}
const report = (label, flag) => {
    const fired = items.filter(flag)
    const wr = (l) => l.filter((i) => !i.correct)
    const miss = (l) => l.filter((i) => i.record.stratum === "miss")
    const hit = (l) => l.filter((i) => i.record.stratum === "hit")
    console.log(`${label.padEnd(40)} fires ${String(fired.length).padStart(3)} | miss: ${wr(miss(fired)).length}/${wr(miss(items)).length} wrong, ${miss(fired).length - wr(miss(fired)).length} right | hit: ${wr(hit(fired)).length}/${wr(hit(items)).length} wrong, ${hit(fired).length - wr(hit(fired)).length} right | fired&wrong&evidence-in-mailbox20-unshown ${fired.filter((i) => !i.correct && i.u20).length}`)
}
console.log(`answered ${items.length}; wrong ${items.filter((i) => !i.correct).length}; names present in ${items.filter((i) => i.names.length).length} questions`)
report("attributed email not answer-bearing", (i) => !i.attrBearing)
report("attributed from other mailbox", (i) => !i.ownMailbox)
for (const t of [0.5, 0.67, 0.99]) report(`nameCov < ${t}`, (i) => i.nameCov < t)
for (const t of [0.4, 0.5, 0.6]) report(`qCov < ${t}`, (i) => i.qCov < t)
report("nameCov<0.99 or qCov<0.5", (i) => i.nameCov < 0.99 || i.qCov < 0.5)
report("nameCov<0.67 or qCov<0.4", (i) => i.nameCov < 0.67 || i.qCov < 0.4)
report("attrShare < 0.6", (i) => i.attrShare < 0.6)
emails.close()
