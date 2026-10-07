// Worker c (round 5): how emails and the question are presented to e2b.
// Notes: docs/premise-study/explore2/c.md
//
// Composable pieces (exported; the lead can combine them with worker b's demos):
//   units(email)                    sentence-like reading units of the body (+ header fields)
//   lexScores(question, texts)      cheap lexical relevance of units to the question
//   keyLines(question, emails, o)   the k most question-relevant units over a context
//   segmentThread(email)            own thread segmenter (Outlook, Lotus reply/forward, "X on date")
//   renderThread(email, o)          email with one label line per message ("[Message 2 of 3 |
//                                   From: X | To: Y | Date: D | Subject: S]"), body lines untouched
//   renderEmail(email, o)           R0 / thread / clean renderings, one entry point
//   cPrompt(question, emails, o)    sandwich prompt (gates' wording) with optional rendering,
//                                   key-line excerpt block and question-type hint; with no
//                                   options it is byte-identical to sandwichPrompt.
import { sandwichPrompt } from "../../explore/variants.js"
import { ABSTAIN } from "../../prompts.js"
import { splitFile, parseFileHeader, contentWords, questionType } from "../../text.js"

// ---------------------------------------------------------------- units

const HEADER_FIELD = /^\s*(From|Sent|Date|To|Cc|Bcc|Subject|Importance|Attachments|Sent by)\s*:/i

// Body split into reading units: wrapped lines of a paragraph are joined, then split
// into sentences; header-like lines stay single units. Each unit keeps the original
// line range so a renderer can mark it in place.
export function units(email) {
    const { body } = splitFile(email)
    const lines = body.split("\n")
    // header blocks of embedded messages (own segmenter): their lines are header units,
    // and every unit records the message it belongs to and that message's sender
    const seg = segmentThread(email)
    const msgOf = new Array(lines.length).fill(0)
    const inHdr = new Array(lines.length).fill(false)
    seg.blocks.forEach((b, k) => { for (let i = b.start; i < lines.length; i++) msgOf[i] = k + 1; for (let i = b.start; i <= b.end; i++) inHdr[i] = true })
    const senders = [cleanName(seg.top.sender), ...seg.blocks.map((b) => b.from)]
    const out = []
    let para = []
    const flush = () => {
        if (!para.length) return
        const text = para.map((p) => p.text.trim()).join(" ").replace(/\s+/g, " ").trim()
        const first = para[0].i, last = para[para.length - 1].i
        // sentence split (keeps abbreviations like "Mr." mostly intact by requiring a capital/digit next)
        const parts = text.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/)
        for (const s of parts) if (s.trim().length >= 3) out.push({ text: s.trim(), first, last, msg: msgOf[first], from: senders[msgOf[first]] ?? "" })
        para = []
    }
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim()) { flush(); continue }
        if (inHdr[i] || HEADER_FIELD.test(line) || /^\s*-{3,}/.test(line)) { flush(); out.push({ text: line.trim(), first: i, last: i, header: true }); continue }
        para.push({ text: line, i })
        // a short line ends its unit (lists, tables, signatures); long lines are hard-wrapped prose
        if (line.trim().length < 55 || para.length >= 12) flush()
    }
    flush()
    return out
}

// Lexical relevance: question content words found in the unit, weighted by how rare the
// word is among all units of the context (a word in every unit carries no signal).
export function lexScores(question, texts) {
    const q = contentWords(question)
    const sets = texts.map((t) => new Set(contentWords(t)))
    const df = new Map(q.map((w) => [w, sets.filter((s) => s.has(w)).length]))
    const n = texts.length || 1
    return sets.map((s) => q.reduce((sum, w) => sum + (s.has(w) ? Math.log(1 + n / (df.get(w) || 1)) : 0), 0))
}

// The k most relevant units over a context: [{ email (0-based), text, score, first, last }].
// scorer(question, texts) -> scores (sync or async); default lexical.
export async function keyLines(question, emails, { k = 3, scorer = lexScores, minChars = 20, maxChars = 400 } = {}) {
    const all = []
    emails.forEach((email, e) => { for (const u of units(email)) if (!u.header && u.text.length >= minChars) all.push({ email: e, ...u, text: u.text.length > maxChars ? `${u.text.slice(0, maxChars)} …` : u.text }) })
    if (!all.length) return []
    const scores = await scorer(question, all.map((u) => u.text))
    all.forEach((u, i) => { u.score = scores[i] })
    const seen = new Set()
    const top = [...all].sort((a, b) => b.score - a.score).filter((u) => { const t = u.text.toLowerCase(); if (seen.has(t)) return false; seen.add(t); return true }).slice(0, k)
    // context order (email, then position)
    return top.sort((a, b) => a.email - b.email || a.first - b.first)
}

// ---------------------------------------------------------------- thread segmenter

const DT = String.raw`\d{1,2}\/\d{1,2}\/\d{2,4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?(?:\s+[A-Z]{2,4}\b)?)?`
const RE = {
    outlook: /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
    fwdOpen: /^\s*-{2,}\s*Forwarded by\s+(.*)$/i,
    field: /^\s*(From|Sent by|Sent|Date|To|Cc|Bcc|Subject|Importance|Attachments)\s*:\s?(.*)$/i,
    nameDate: new RegExp(String.raw`^\s*(?:From:\s*)?(.+?)\s+(?:on\s+)?(${DT})\s*$`, "i"),
    dateOnly: new RegExp(String.raw`^\s*(${DT})\s*$`, "i"),
    respond: /^\s*Please respond to\b/i,
    company: /^\s*(Enron\b.*(Corp|Inc|Ltd|LLC)\.?|.*\b(Corp|Corporation|Inc|Ltd)\.?)\s*$/i,
}
const isBlank = (l) => !String(l ?? "").replace(/=20/g, "").trim()
const strip = (l) => String(l ?? "").replace(/^(\s*>)+\s?/, "").trim()

// "mike.curry@enron.com" -> "Mike Curry" (first.last addresses only; others unchanged)
export function nameOf(address) {
    const m = String(address ?? "").trim().match(/^([a-z]+)\.(?:[a-z]\.)?([a-z]+)@/i)
    if (!m) return String(address ?? "").trim()
    const cap1 = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    return `${cap1(m[1])} ${cap1(m[2])}`
}
// Lotus "Dan J Hyvl/HOU/ECT@ECT" -> "Dan J Hyvl"; "x@y.com@SMTP@enronXgate" -> "x@y.com";
// Outlook "Shively, Hunter S." -> "Hunter S. Shively"; quotes and <addr> kept readable.
export function cleanName(raw) {
    let s = String(raw ?? "").replace(/\s+/g, " ").trim().replace(/^["']+|["']+$/g, "")
    if (!s) return s
    const mailto = s.match(/\[mailto:([^\]]*)\]/i)
    s = s.replace(/\[mailto:[^\]]*\]/i, "").trim()
    if (mailto && /IMCEANOTES/i.test(mailto[1])) return cleanName(s)
    if (mailto) return mailto[1].trim().toLowerCase() === s.toLowerCase() ? s : `${cleanName(s)} <${mailto[1].trim()}>`
    s = s.replace(/^"([^"]+)"\s*<([^>]+)>$/, "$1 <$2>").replace(/>@[A-Za-z]+$/, ">").replace(/"/g, "").trim()
    if (/@SMTP@/i.test(s)) s = s.replace(/@SMTP@.*$/i, "")
    if (/^[^@<>\/]+\/\S+$/.test(s)) s = s.split("/")[0].trim()
    else if (/^[a-z]+[._][a-z]+@enron\.com$/i.test(s)) s = nameOf(s)
    else if (/^[^@<>/]+@[A-Za-z_\-]+$/.test(s) && !/\./.test(s.split("@")[1])) s = s.split("@")[0].trim() // "Name@ENRON"
    const comma = s.match(/^([A-Z][A-Za-z'\-]+(?: Jr\.?)?),\s+([A-Z][A-Za-z.\- ]+)$/)
    if (comma) s = `${comma[2].trim()} ${comma[1]}`
    return s.replace(/\s+/g, " ").trim()
}
const cleanList = (raw) => {
    const text = String(raw ?? "").replace(/\s+/g, " ").trim()
    if (!text) return ""
    // a single Outlook "Last, First M." name
    if (!/[;\/@]/.test(text) && /^[A-Z][A-Za-z'\-]+(?: Jr\.?)?, [A-Z][A-Za-z.\-]*(?: [A-Z][A-Za-z.\-]*)?$/.test(text)) return cleanName(text)
    // Outlook separates with ";" (names contain ","), Lotus with ","
    const parts = text.includes(";") ? text.split(";") : text.split(/,(?![^<]*>)/)
    return parts.map(cleanName).filter(Boolean).join(", ")
}

// Header blocks inside a body. Anchor: a "To:" line (Lotus, Outlook) or an Outlook
// "-----Original Message-----" / "From:"+"Sent:" pair. A block reaches back over the
// sender/date/company/forward lines and forward over cc/bcc/subject lines.
export function segmentThread(email) {
    const { header, body } = splitFile(email)
    const lines = body.split("\n")
    const top = parseFileHeader(header)
    const blocks = []
    let last = -1 // last line index consumed by a block
    for (let i = 0; i < lines.length; i++) {
        if (i <= last) continue
        const s = strip(lines[i])
        const isTo = /^To\s*:/i.test(s)
        const isOutlook = RE.outlook.test(s)
        const isFromSent = /^From\s*:/i.test(s) && /^Sent\s*:/i.test(strip(lines[i + 1] ?? ""))
        const isFwd = RE.fwdOpen.test(s)
        if (!isTo && !isOutlook && !isFromSent && !isFwd) continue
        // the anchor's To: line (search forward a little for Outlook / From-Sent / forward anchors)
        let toAt = isTo ? i : -1
        if (!isTo) for (let j = i + 1; j <= Math.min(lines.length - 1, i + 9); j++) { const t = strip(lines[j]); if (/^To\s*:/i.test(t)) { toAt = j; break } if (/^Subject\s*:/i.test(t) && j > i + 1) break }
        if (toAt < 0 && !isOutlook && !isFwd) continue
        // reach back from the block's first anchor line
        let start = isTo ? i : i
        const f = { from: "", date: "", to: "", cc: "", bcc: "", subject: "", importance: "", attachments: "", fwdBy: "", fwdOn: "", kind: isOutlook ? "outlook" : isFwd ? "forward" : "reply" }
        if (isTo) {
            for (let j = i - 1; j > last && j >= i - 8; j--) {
                const t = strip(lines[j])
                if (isBlank(lines[j]) || RE.respond.test(t) || RE.company.test(t) || /^Sent by\s*:/i.test(t)) { start = j; continue }
                const fm = t.match(RE.field)
                if (fm && /^(from|sent|date)$/i.test(fm[1])) { start = j; continue }
                if (RE.outlook.test(t) || RE.fwdOpen.test(t) || /^((\d{1,2}:\d{2}\s*)?(AM|PM))?\s*-{3,}\s*$/i.test(t)) { start = j; continue }
                if (RE.nameDate.test(t) || RE.dateOnly.test(t)) { start = j; continue }
                // a bare name line right above a date-only line (Lotus two-line sender)
                if (j + 1 < lines.length && RE.dateOnly.test(strip(lines[j + 1])) && t.length <= 60 && t.split(/\s+/).length <= 6) { start = j; continue }
                // wrapped forward line ("... on 03/16/2000 " + "02:50 PM -----")
                break
            }
            // do not swallow trailing blank lines of the previous message
            while (start < i && isBlank(lines[start])) start++
        }
        // a bare "To:" line with no sender/date above and no cc/subject below is body text (a memo "TO: APPA")
        if (isTo && start === i && !/^(cc|bcc|subject)\s*:/i.test(strip(lines[i + 1] ?? "")) && !/^(cc|bcc|subject)\s*:/i.test(strip(lines[i + 2] ?? ""))) continue
        // forward: header lines from start to the end of cc/subject
        let end = Math.max(i, toAt)
        if (toAt >= 0) {
            for (let j = toAt + 1; j < lines.length && j <= toAt + 8; j++) {
                const t = strip(lines[j])
                if (/^(cc|bcc|subject|importance|attachments|date|sent)\s*:/i.test(t)) { end = j; continue }
                if (isBlank(lines[j])) { const nx = strip(lines[j + 1] ?? ""); if (/^(cc|bcc|subject)\s*:/i.test(nx)) { end = j; continue } break }
                // continuation of a wrapped To/cc list (Lotus addresses)
                if (/[\/@]/.test(t) && !/[.!?]$/.test(t) && t.length < 120 && !/^subject/i.test(strip(lines[end]))) { end = j; continue }
                break
            }
        } else if (isFwd) {
            // forward line, possibly wrapped onto a second line ending in dashes
            if (!/-{3,}\s*$/.test(s) && /-{3,}\s*$/.test(strip(lines[i + 1] ?? ""))) end = i + 1
        }
        // a long Subject line wrapped by the mail client: one short continuation line before a blank
        if (/^Subject\s*:/i.test(strip(lines[end])) && String(lines[end]).trim().length >= 65) {
            const nx = strip(lines[end + 1] ?? "")
            if (nx && nx.length <= 60 && !/[.!?:,;]$/.test(nx) && isBlank(lines[end + 2])) end++
        }
        // parse fields in [start, end]
        let cur = null
        for (let j = start; j <= end; j++) {
            const raw = lines[j]
            const t = strip(raw)
            if (!t) { cur = null; continue }
            const fw = t.match(/^-{2,}\s*Forwarded by\s+(.+?)(?:\s+on\s+(.+?))?\s*-*\s*$/i)
            if (fw) { f.fwdBy = cleanName(fw[1].replace(/\s+on$/i, "")); f.fwdOn = (fw[2] ?? "").replace(/-+$/, "").trim(); cur = "fwd"; continue }
            if (cur === "fwd" && /^(\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|AM\b|PM\b)/i.test(t)) { f.fwdOn = `${f.fwdOn} ${t.replace(/-+\s*$/, "").trim()}`.trim(); continue }
            const fm = t.match(RE.field)
            if (fm) {
                const k = fm[1].toLowerCase()
                const v = fm[2].trim()
                if (k === "from") { const nd = v.match(new RegExp(String.raw`^(.+?)\s{2,}(${DT})\s*$`, "i")); if (nd) { f.from = cleanName(nd[1]); f.date = nd[2] } else f.from = cleanName(v.replace(/\s+on\s+\d.*$/, "")); const on = v.match(new RegExp(String.raw`\s+on\s+(${DT})`, "i")); if (on) f.date = on[1] }
                else if (k === "sent" || k === "date") f.date = v
                else if (k === "sent by") f.sentBy = cleanName(v)
                else if (k in f) f[k] = v
                cur = k
                continue
            }
            if ((cur === "to" || cur === "cc" || cur === "bcc") && /[\/@,]/.test(t)) { f[cur] = `${f[cur]} ${t}`; continue }
            if (cur === "subject") { f.subject = `${f.subject} ${t}`; continue }
            if (RE.outlook.test(t) || RE.company.test(t) || RE.respond.test(t) || /^-{3,}/.test(t)) continue
            const nd = t.match(RE.nameDate)
            if (nd && !f.from) { f.from = cleanName(nd[1]); f.date = nd[2]; continue }
            if (RE.dateOnly.test(t)) { f.date ||= t; continue }
            if (!f.from && t.length <= 60) { f.from = cleanName(t); continue }
        }
        f.to = cleanList(f.to); f.cc = cleanList(f.cc); f.bcc = cleanList(f.bcc)
        f.subject = f.subject.replace(/\s+/g, " ").trim()
        blocks.push({ start, end, ...f })
        last = end
    }
    // merge a bare forward block with the header block right after it (same message)
    const merged = []
    for (const b of blocks) {
        const prev = merged[merged.length - 1]
        if (prev && prev.kind === "forward" && !prev.from && !prev.to && b.start - prev.end <= 4 && lines.slice(prev.end + 1, b.start).every(isBlank)) {
            merged[merged.length - 1] = { ...b, start: prev.start, fwdBy: prev.fwdBy, fwdOn: prev.fwdOn, kind: b.kind === "reply" ? "forwarded" : b.kind }
        } else merged.push(b)
    }
    return { header, top, lines, blocks: merged }
}

const cap = (list, n) => { const parts = list ? list.split(", ") : []; return parts.length > n ? `${parts.slice(0, n).join(", ")} and ${parts.length - n} others` : list }

// One label line per message. The newest message (the email itself) gets the file header
// as From/To; embedded messages get their parsed header. Body lines are untouched; the
// raw header lines of embedded messages are replaced by the label.
export function renderThread(email, { maxRecipients = Infinity, keepFile = false, single = "label" } = {}) {
    const { header, top, lines, blocks } = segmentThread(email)
    const n = blocks.length + 1
    if (n === 1 && single === "r0") return email.trim()
    const person = (raw) => {
        const r = String(raw ?? "").trim()
        const name = cleanName(r)
        return /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(r) && name !== r ? `${name} <${r}>` : name
    }
    const topLabel = [
        n > 1 ? `Message 1 of ${n} (newest; the email itself)` : "Email",
        top.sender && `From: ${person(top.sender)}`,
        top.recipients.length && `To: ${cap(top.recipients.map(person).join(", "), maxRecipients)}`,
        top.subject && `Subject: ${top.subject}`,
    ].filter(Boolean)
    const out = [`[${topLabel.join(" | ")}]`]
    if (keepFile && top.file) out.push(`File: ${top.file}`)
    let cursor = 0
    blocks.forEach((b, index) => {
        const bodyPart = lines.slice(cursor, b.start).join("\n").replace(/\s+$/, "")
        if (bodyPart.trim()) out.push(bodyPart.replace(/^\n+/, ""))
        const parts = [`Message ${index + 2} of ${n}${b.kind === "outlook" ? ", earlier message quoted below" : b.fwdBy ? ", forwarded" : ", earlier message"}`]
        if (b.fwdBy) parts.push(`forwarded by ${b.fwdBy}${b.fwdOn ? ` on ${b.fwdOn}` : ""}`)
        if (b.from) parts.push(`From: ${b.from}`)
        if (b.sentBy) parts.push(`Sent by: ${b.sentBy}`)
        if (b.date) parts.push(`Date: ${b.date}`)
        if (b.to) parts.push(`To: ${cap(b.to, maxRecipients)}`)
        if (b.cc) parts.push(`Cc: ${cap(b.cc, maxRecipients)}`)
        if (b.subject) parts.push(`Subject: ${b.subject}`)
        if (b.importance) parts.push(`Importance: ${b.importance}`)
        if (b.attachments) parts.push(`Attachments: ${b.attachments}`)
        out.push("", `[${parts.join(" | ")}]`)
        cursor = b.end + 1
    })
    const rest = lines.slice(cursor).join("\n").replace(/^\n+/, "").replace(/\s+$/, "")
    if (rest.trim()) out.push(rest)
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

// Chronological thread: the same labelled messages as renderThread, oldest first, so a
// reply chain reads as a conversation; the email itself (newest) comes last and says so.
// Single-message emails stay R0.
export function renderChrono(email) {
    const { top, lines, blocks } = segmentThread(email)
    const n = blocks.length + 1
    if (n === 1) return email.trim()
    const person = (raw) => {
        const r = String(raw ?? "").trim()
        const name = cleanName(r)
        return /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(r) && name !== r ? `${name} <${r}>` : name
    }
    const msgs = []
    const topBody = lines.slice(0, blocks[0].start).join("\n").replace(/^\n+/, "").replace(/\s+$/, "")
    msgs.push({ head: [top.sender && `From: ${person(top.sender)}`, top.recipients.length && `To: ${top.recipients.map(person).join(", ")}`, top.subject && `Subject: ${top.subject}`].filter(Boolean), body: topBody, newest: true })
    blocks.forEach((b, i) => {
        const end = i + 1 < blocks.length ? blocks[i + 1].start : lines.length
        const body = lines.slice(b.end + 1, end).join("\n").replace(/^\n+/, "").replace(/\s+$/, "")
        const head = []
        if (b.fwdBy) head.push(`forwarded by ${b.fwdBy}${b.fwdOn ? ` on ${b.fwdOn}` : ""}`)
        if (b.from) head.push(`From: ${b.from}`)
        if (b.sentBy) head.push(`Sent by: ${b.sentBy}`)
        if (b.date) head.push(`Date: ${b.date}`)
        if (b.to) head.push(`To: ${b.to}`)
        if (b.cc) head.push(`Cc: ${b.cc}`)
        if (b.subject) head.push(`Subject: ${b.subject}`)
        if (b.importance) head.push(`Importance: ${b.importance}`)
        if (b.attachments) head.push(`Attachments: ${b.attachments}`)
        msgs.push({ head, body })
    })
    const out = [`[A thread of ${n} messages, oldest first; the last one is the email itself.]`]
    msgs.reverse().forEach((m, i) => {
        const tag = i === 0 ? `Message ${i + 1} of ${n} (oldest)` : m.newest ? `Message ${i + 1} of ${n} (newest; the email itself)` : `Message ${i + 1} of ${n}`
        out.push("", `[${[tag, ...m.head].join(" | ")}]`)
        if (m.body.trim()) out.push(m.body)
    })
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

// ---------------------------------------------------------------- prompt

// Raw SMTP header lines inside bodies (forwarded internet mail) and the File: line.
const RAW_HDR = /^\s*(Received|Return-Path|X-[\w-]+|Message-ID|Mime-Version|Content-Type|Content-Transfer-Encoding|Content-Disposition|Delivered-To|In-Reply-To|References|Thread-Topic|Thread-Index|Full-name)\s*:/i
export function renderClean(email) {
    const { header, body } = splitFile(email)
    const head = header.split("\n").filter((l) => !/^File:/i.test(l)).join("\n")
    const kept = body.split("\n").filter((l) => !RAW_HDR.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim()
    return `${head}\n=====\n${kept}`
}

export function renderEmail(email, { render = "r0", ...o } = {}) {
    if (render === "r0") return email
    if (render === "thread") return renderThread(email, o)
    if (render === "thread1") return renderThread(email, { ...o, single: "r0" })
    if (render === "clean") return renderClean(email)
    if (render === "chrono") return renderChrono(email)
    throw new Error(`unknown render ${render}`)
}

export const HINTS = {
    who: "The question asks for a person or people: name them as the email does, and check who wrote, received or is mentioned in each message.",
    when: "The question asks for a date or time: give the exact one the emails state for that event.",
    number: "The question asks for a number or amount: copy the exact figure for what is asked.",
    "url-contact": "The question asks for contact details or a link: copy them exactly.",
}

// v2 (who only): the relation rule a thread needs; pairs with thread / chrono labels.
export const HINTS2 = {
    who: "The question asks for a person. Each message in a thread has its own sender (From) and recipients (To); inside a message, \"I\" is its sender and \"you\" its recipient. Name the person the question asks about.",
}

// gates' sandwich prompt with optional pieces. No options -> sandwichPrompt exactly.
//   render  "r0" | "thread" | "thread1" | "clean"
//   keys    [{ email, text }] from keyLines(): an excerpt block after the emails
//   hint    true -> one question-type rule (HINTS) for who/when/number/url-contact questions
export function cPrompt(question, emails, { render = "r0", keys = null, hint = false, keysLabel = "Lines from the emails above that look most relevant to the question (read them in context):" } = {}) {
    const shown = emails.map((e) => renderEmail(e, { render }))
    const rule = hint === 2 ? HINTS2[questionType(question)] ?? "" : hint ? HINTS[questionType(question)] ?? "" : ""
    if (!keys?.length) return sandwichPrompt(question, shown, rule)
    const base = sandwichPrompt(question, shown, rule)
    const tail = `\nQuestion: ${question}\nAnswer:`
    if (!base.endsWith(tail)) throw new Error("sandwich tail changed")
    const block = `${keysLabel}\n${keys.map((k) => `[${k.email + 1}${k.from ? `, from ${k.from}` : ""}] "${k.text}"`).join("\n")}\n`
    return `${base.slice(0, base.length - tail.length)}\n${block}${tail}`
}

// The email (R0) with the key units of this email wrapped in **bold** where they occur
// (whitespace-insensitive match of the unit text; units not found are left unmarked).
export function markEmail(email, keys) {
    let out = email
    for (const k of keys) {
        const text = k.text.replace(/ …$/, "")
        const pattern = text.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
        if (!pattern) continue
        const m = new RegExp(pattern).exec(out)
        if (m) out = `${out.slice(0, m.index)}**${m[0]}**${out.slice(m.index + m[0].length)}`
    }
    return out
}

// cPrompt with the key units marked in place instead of an excerpt block.
export function markPrompt(question, emails, keys, { render = "r0" } = {}) {
    const marked = emails.map((e, i) => markEmail(e, keys.filter((k) => k.email === i)))
    return sandwichPrompt(question, marked.map((e) => renderEmail(e, { render })))
}

// MiniLM cross-encoder scorer over unit texts (CPU), loaded once per run.
export const ceScorerOf = (ctx) => async (question, texts) => {
    const { loadReranker } = await import("../../rerank.js")
    const { join } = await import("node:path")
    const model = await ctx.resource("r-minilm", () => loadReranker(join(ctx.dataDir, "..", "models")))
    return model.score(question, texts)
}

export const _test = { ABSTAIN }

// ---------------------------------------------------------------- gold-only harness

// c-gold (DIAGNOSTIC, not selectable): on hit questions, the gold email alone read with
// several presentations, one call each (base = oracles' prompt exactly). The stored
// answer is the base one; the others are in `renders` (graded offline by c-grade.js).
// An identical prompt is not re-asked (its answer is copied), so differences between
// renders come only from prompts that actually changed. Misses are skipped (no call).
export const GOLD_RENDERS = {
    base: (q, e) => cPrompt(q, [e]),
    thread: (q, e) => cPrompt(q, [e], { render: "thread" }),
    thread1: (q, e) => cPrompt(q, [e], { render: "thread1" }),
    keys: async (q, e) => cPrompt(q, [e], { keys: await keyLines(q, [e], { k: 3 }) }),
    hint: (q, e) => cPrompt(q, [e], { hint: true }),
    // c-gold2: cross-encoder key units (k = 3)
    keysce: async (q, e, ctx) => cPrompt(q, [e], { keys: await keyLines(q, [e], { k: 3, scorer: ceScorerOf(ctx) }) }),
    markce: async (q, e, ctx) => markPrompt(q, [e], await keyLines(q, [e], { k: 3, scorer: ceScorerOf(ctx) })),
    tkce: async (q, e, ctx) => cPrompt(q, [e], { render: "thread1", keys: await keyLines(q, [e], { k: 3, scorer: ceScorerOf(ctx) }) }),
    // c-gold3: chronological thread (oldest first), alone and with the question-type hint
    chrono: (q, e) => cPrompt(q, [e], { render: "chrono" }),
    chronohint: (q, e) => cPrompt(q, [e], { render: "chrono", hint: true }),
    // c-goldx (config-driven): who relation rule, marks on the thread rendering
    threadh2: (q, e) => cPrompt(q, [e], { render: "thread", hint: 2 }),
    chronoh2: (q, e) => cPrompt(q, [e], { render: "chrono", hint: 2 }),
    markthread: async (q, e, ctx) => markPrompt(q, [e], await keyLines(q, [e], { k: 3, scorer: ceScorerOf(ctx) }), { render: "thread" }),
    clean: (q, e) => cPrompt(q, [e], { render: "clean" }),
}
async function goldRenders(ctx, record, names, only = null) {
    if (record.stratum !== "hit" || (only && !only.includes(questionType(record.question)))) return { status: "skipped", answer: "", contextPaths: [record.path] }
    const email = ctx.emailOf(record.path)
    const renders = {}
    const byPrompt = new Map()
    let base = null
    for (const name of names) {
        const prompt = await GOLD_RENDERS[name](record.question, email, ctx)
        if (byPrompt.has(prompt)) { renders[name] = { ...byPrompt.get(prompt), copied: true }; continue }
        const r = await ctx.generate({ prompt })
        const out = { status: r.status, answer: r.answer ?? "", chars: prompt.length }
        byPrompt.set(prompt, out)
        renders[name] = out
        base ??= out
    }
    return { status: base.status, answer: base.answer, contextPaths: [record.path], readPaths: [record.path], renders }
}

export const VARIANTS = {
    "c-gold": { version: 2, diagnostic: true, describe: "DIAGNOSTIC: hits only, gold email alone with 5 presentations (base = oracles, thread labels, thread labels on chains only, lexical key-line excerpt, question-type hint); answer = base", run: (ctx, record) => goldRenders(ctx, record, ["base", "thread", "thread1", "keys", "hint"]) },
    "c-gold2": { version: 2, diagnostic: true, describe: "DIAGNOSTIC: hits only, gold email alone: base, CE key-unit excerpt (k=3), CE key units marked **bold** in place, thread labels on chains + CE excerpt; answer = base", run: (ctx, record) => goldRenders(ctx, record, ["base", "keysce", "markce", "tkce"]) },
    "c-gold3": { version: 2, diagnostic: true, describe: "DIAGNOSTIC: hits only, gold email alone: base, chronological thread (oldest first, labelled; single emails R0), chronological + question-type hint; answer = base", run: (ctx, record) => goldRenders(ctx, record, ["base", "chrono", "chronohint"]) },
}

// c-goldx: gold-only diagnostic whose render list (and optional question-type filter)
// is read from c-final.json "c-goldx" when the run starts its questions; the config
// hash is stored with each answer (cfg). Fixed before the run, never changed after.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
VARIANTS["c-goldx"] = {
    version: 1, diagnostic: true,
    describe: "DIAGNOSTIC: gold-only renders listed in variants/c-final.json c-goldx (hits only; optional question-type filter); answer = first render",
    run: async (ctx, record) => {
        const c = JSON.parse(readFileSync(new URL("./c-final.json", import.meta.url), "utf8"))["c-goldx"]
        const out = await goldRenders(ctx, record, c.renders, c.only ?? null)
        return { ...out, cfg: createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 8) }
    },
}
