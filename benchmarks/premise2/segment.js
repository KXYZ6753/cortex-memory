// Deterministic thread segmenter for EnronQA email bodies.
//
// A file body is the newest message followed by any number of embedded (quoted
// or forwarded) messages, each introduced by a header block. Five header styles
// cover the corpus: Outlook "-----Original Message-----" (~62%), Lotus two-line
// "Name / date / To:" (~14%), Lotus "----- Forwarded by X on date -----" (~9%),
// Lotus "X on date" replies (~8%) and bare "From: / Sent:" blocks (~8%).
//
// Segmentation is lossless by construction: every body line belongs to exactly one
// message, as either a header line or a body line, so rendering can relabel
// headers without touching a single body line.

const FIELD = /^\s*(From|Sent by|Sent|Date|To|Cc|Bcc|Subject|Importance|Attachments)\s*:[ \t]?(.*)$/i
const OUTLOOK = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i
const FORWARD = /^\s*-{2,}\s*Forwarded by\s+(.+?)\s+on\s+(.+?)\s*-{2,}\s*$/i
const FORWARD_OPEN = /^\s*-{2,}\s*Forwarded by\s+.+$/i
const DATE_TIME = String.raw`\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?(?:\s+[A-Z]{2,4})?`
const DATE_ONLY = new RegExp(String.raw`^\s*(${DATE_TIME})\s*$`, "i")
const ON_DATE = new RegExp(String.raw`^\s*(?:From:\s*)?(.+?)\s+on\s+(${DATE_TIME})\s*$`, "i")
const NAME_DATE = new RegExp(String.raw`^\s*(.+?)\s{2,}(${DATE_TIME})\s*$`, "i")

// Detection reads a normalised view of each line: ">" quote prefixes and
// quoted-printable noise removed. Rendering always uses the original line, so
// the view never leaks into output.
const view = (line) => String(line ?? "")
    .replace(/^(?:\s*>)+ ?/, "")
    .replace(/=20/g, " ")
    .replace(/=09/g, "\t")
    .replace(/=\s*$/, "")

const fieldName = (line) => view(line).match(FIELD)?.[1]?.toLowerCase() ?? null
const fieldValue = (line) => view(line).match(FIELD)?.[2]?.trim() ?? ""
const isBlank = (line) => !view(line).trim()

function looksLikeName(text) {
    const value = text.trim()
    if (!value || value.length > 80) return false
    if (fieldName(value)) return false
    if (/[.!?]$/.test(value) && !/@/.test(value)) return false
    if (value.split(/\s+/).length > 8) return false
    return /[A-Za-z]/.test(value)
}

// Reads a run of field lines (plus wrapped recipient continuations) starting at
// `start`. Stops after Subject (and any Importance/Attachments right after it),
// at a blank line once a field has been seen, or at any other non-field line.
function readFields(lines, start, fields, maxLines = 16) {
    let index = start
    let seen = 0
    let last = start - 1
    let lastField = null
    let blanksBefore = 0
    while (index < lines.length && index < start + maxLines) {
        const line = lines[index]
        if (isBlank(line)) {
            if (seen === 0 && blanksBefore < 2) {
                blanksBefore++
                index++
                continue
            }
            break
        }
        const name = fieldName(line)
        if (name) {
            const value = fieldValue(line)
            if (lastField === "subject" && !["importance", "attachments"].includes(name)) break
            const key = name === "sent by" ? "sentBy" : name
            fields[key] = fields[key] ? `${fields[key]}, ${value}` : value
            lastField = name
            seen++
            last = index
            index++
            continue
        }
        // Wrapped values: indented lines, "[mailto:...]" lines under From, and
        // recipient lists whose previous line ended with a comma or semicolon.
        const text = view(line)
        // A quoted-printable soft break ("Di=" then "anne") continues any field and
        // must be joined without a space, or the rendered word would split in two.
        const softBreak = lastField !== null && /=\s*$/.test(lines[index - 1] ?? "")
        const continuation = softBreak || (["from", "to", "cc", "bcc", "sent by"].includes(lastField)
            && (/^\s/.test(text) || /^\[mailto:/i.test(text.trim()) || /[,;]\s*$/.test(view(lines[index - 1]))))
        if (continuation) {
            const key = lastField === "sent by" ? "sentBy" : lastField
            fields[key] = softBreak ? `${fields[key]}${text.trim()}` : `${fields[key]} ${text.trim()}`.trim()
            last = index
            index++
            continue
        }
        break
    }
    return { seen, end: last }
}

// Returns { kind, end, fields } when a header block starts at line i, else null.
export function detectHeaderAt(lines, i) {
    const line = view(lines[i])

    if (OUTLOOK.test(line)) {
        const fields = {}
        const { seen, end } = readFields(lines, i + 1, fields)
        return { kind: "outlook", end: seen ? end : i, fields }
    }

    // The forward marker is often wrapped over up to three lines (sometimes with
    // quoted-printable soft breaks), so join lines until the closing dashes.
    let forward = line.match(FORWARD)
    let markerEnd = i
    if (!forward && FORWARD_OPEN.test(line)) {
        let joined = line.trim()
        for (let extra = 1; extra <= 3 && !forward; extra++) {
            const next = view(lines[i + extra])
            if (lines[i + extra] === undefined) break
            joined = `${joined} ${next.trim()}`.replace(/\s+/g, " ")
            forward = joined.match(FORWARD)
            if (forward) markerEnd = i + extra
        }
    }
    if (forward) {
        const fields = { forwardedBy: forward[1].trim(), forwardedOn: forward[2].trim() }
        let next = markerEnd + 1
        let blanks = 0
        while (next < lines.length && isBlank(lines[next]) && blanks < 3) {
            next++
            blanks++
        }
        const inner = detectLotus(lines, next) ?? detectBareFrom(lines, next)
        if (inner) return { kind: "lotus-forward", end: inner.end, fields: { ...fields, ...inner.fields } }
        return { kind: "lotus-forward", end: markerEnd, fields }
    }

    const lotus = detectLotus(lines, i)
    if (lotus) return lotus

    return detectBareFrom(lines, i)
}

// A "From: / Sent: / To: / Subject:" block with no marker line above it. The
// 4-line window also covers a wrapped "[mailto:...]" line under From.
function detectBareFrom(lines, i) {
    if (!/^\s*From:\s*\S/i.test(view(lines[i]))) return null
    const window = lines.slice(i + 1, i + 5).map(fieldName)
    if (!window.some((name) => name === "sent" || name === "date")) return null
    if (!window.some((name) => name === "to" || name === "subject")) return null
    const fields = {}
    const { end } = readFields(lines, i, fields)
    return { kind: "outlook-bare", end, fields }
}

// Index of the first non-blank line at or after `from`, looking at most `limit` lines.
function nextContent(lines, from, limit = 4) {
    for (let index = from; index < lines.length && index < from + limit; index++) if (!isBlank(lines[index])) return index
    return -1
}

// Lotus Notes headers: "Name on date" replies, and "Name / [Sent by] / date / To:"
// two-line blocks (often tab-indented inside forwards).
function detectLotus(lines, i) {
    const line = view(lines[i])
    if (isBlank(lines[i])) return null

    const onDate = line.match(ON_DATE)
    if (onDate && looksLikeName(onDate[1].replace(/^From:\s*/i, ""))) {
        const lookahead = lines.slice(i + 1, i + 4).map(fieldName)
        if (lookahead.includes("to")) {
            const fields = { from: onDate[1].replace(/^From:\s*/i, "").trim(), sent: onDate[2].trim() }
            const { end } = readFields(lines, i + 1, fields)
            return { kind: "lotus-reply", end: Math.max(end, i), fields }
        }
    }

    // "Name        02/10/2000 02:50 PM" on one line, To: a few lines below.
    const nameDate = line.match(NAME_DATE)
    if (nameDate && looksLikeName(nameDate[1])) {
        const probe = nextContent(lines, i + 1, 5)
        const probeName = probe >= 0 ? fieldName(lines[probe]) : null
        if (probeName === "to" || probeName === "sent by") {
            const fields = { from: nameDate[1].trim(), sent: nameDate[2].trim() }
            const { end } = readFields(lines, i + 1, fields)
            return { kind: "lotus-two-line", end: Math.max(end, i), fields }
        }
    }

    if (looksLikeName(line) && !DATE_ONLY.test(line)) {
        let cursor = i + 1
        const fields = { from: line.trim() }
        if (fieldName(lines[cursor] ?? "") === "sent by") {
            fields.sentBy = fieldValue(lines[cursor])
            cursor++
        }
        const date = view(lines[cursor]).match(DATE_ONLY)
        if (date) {
            fields.sent = date[1].trim()
            cursor++
            let probe = cursor
            while (probe < lines.length && probe < cursor + 2 && isBlank(lines[probe])) probe++
            if (fieldName(lines[probe] ?? "") === "sent by") probe++
            if (fieldName(lines[probe] ?? "") === "to") {
                const { end } = readFields(lines, cursor, fields)
                return { kind: "lotus-two-line", end: Math.max(end, cursor - 1), fields }
            }
        }
    }
    return null
}

// messages[0] is the newest (top) message and has no header lines. Each message
// records [headerStart, headerEnd] and [bodyStart, bodyEnd] as inclusive line
// indices into `lines`; an empty range has end < start.
export function segmentBody(body) {
    const lines = body.split("\n")
    const headers = []
    for (let index = 0; index < lines.length; index++) {
        const header = detectHeaderAt(lines, index)
        if (!header) continue
        headers.push({ start: index, ...header })
        index = header.end
    }
    const messages = [{
        index: 1,
        kind: "top",
        headerStart: 0,
        headerEnd: -1,
        bodyStart: 0,
        bodyEnd: (headers[0]?.start ?? lines.length) - 1,
        fields: {},
    }]
    headers.forEach((header, position) => {
        messages.push({
            index: position + 2,
            kind: header.kind,
            headerStart: header.start,
            headerEnd: header.end,
            bodyStart: header.end + 1,
            bodyEnd: (headers[position + 1]?.start ?? lines.length) - 1,
            fields: header.fields,
        })
    })
    return { lines, messages }
}

export const messageText = (segmented, message) =>
    segmented.lines.slice(message.bodyStart, message.bodyEnd + 1).join("\n")

export const headerText = (segmented, message) =>
    message.headerEnd < message.headerStart ? "" : segmented.lines.slice(message.headerStart, message.headerEnd + 1).join("\n")

// Invariant used by tests: the segments tile the body exactly.
export function reassemble(segmented) {
    const out = []
    for (const message of segmented.messages) {
        if (message.headerEnd >= message.headerStart) out.push(...segmented.lines.slice(message.headerStart, message.headerEnd + 1))
        out.push(...segmented.lines.slice(message.bodyStart, message.bodyEnd + 1))
    }
    return out.join("\n")
}

// --- additive normalisation helpers (never replace the original string) ---

const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

export function readableName(raw) {
    const value = String(raw ?? "").trim()
    if (!value) return null
    const address = value.match(/^<?([a-z]{2,})\.(?:([a-z])\.)?([a-z]{2,})@[\w.-]+>?$/i)
    if (address) return [capitalise(address[1]), address[2] ? `${address[2].toUpperCase()}.` : null, capitalise(address[3])].filter(Boolean).join(" ")
    const lastFirst = value.match(/^([A-Z][A-Za-z'-]+),\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.]*)?)\s*$/)
    if (lastFirst) return `${lastFirst[2]} ${lastFirst[1]}`
    const lotus = value.match(/^([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})\/[A-Z0-9/]+(?:@[A-Z0-9]+)?$/i)
    if (lotus) return lotus[1]
    const lotusAt = value.match(/^([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})@[A-Z0-9]+$/i)
    if (lotusAt && !/\./.test(value.split("@")[1])) return lotusAt[1]
    return null
}

// "Name (original)" when a readable form exists and differs; else the original.
export function withReadableName(raw) {
    const value = String(raw ?? "").trim()
    const name = readableName(value)
    return name && name.toLowerCase() !== value.toLowerCase() ? `${name} (${value})` : value
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (value) => String(value).padStart(2, "0")

export function isoDate(raw) {
    const value = String(raw ?? "").trim()
    if (!value) return null
    let year
    let month
    let day
    let rest = ""
    let m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(.*)$/)
    if (m) {
        month = Number(m[1])
        day = Number(m[2])
        year = Number(m[3])
        rest = m[4]
    } else if ((m = value.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(.*)$/))) {
        month = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()]
        day = Number(m[2])
        year = Number(m[3])
        rest = m[4]
    } else if ((m = value.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})(.*)$/))) {
        day = Number(m[1])
        month = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]
        year = Number(m[3])
        rest = m[4]
    } else {
        return null
    }
    if (year < 100) year += year < 50 ? 2000 : 1900
    if (!month || month > 12 || !day || day > 31 || year < 1990 || year > 2010) return null
    const time = rest.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i)
    let clock = ""
    if (time) {
        let hour = Number(time[1])
        const meridiem = time[3]?.toUpperCase()
        if (meridiem === "PM" && hour < 12) hour += 12
        if (meridiem === "AM" && hour === 12) hour = 0
        if (hour < 24) clock = ` ${pad(hour)}:${time[2]}`
    }
    return `${year}-${pad(month)}-${pad(day)}${clock}`
}

export const withIsoDate = (raw) => {
    const value = String(raw ?? "").trim()
    const iso = isoDate(value)
    return iso ? `${value} (${iso})` : value
}
