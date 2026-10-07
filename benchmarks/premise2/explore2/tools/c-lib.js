// Worker c (round 5): shared offline helpers. Pool records + stored exploration answers
// only (no TEST data). Email anatomy: where in the gold email the answer evidence sits.
import { join } from "node:path"
import { ensureEmailStore } from "../../agent-run.js"
import { splitFile, parseFileHeader, contentWords, novelAnswerWords } from "../../text.js"
import { segmentBody } from "../../segment.js"
import { pool, dataDir, loadTable, weightedOf, verdictOf, verdictRow } from "./n-lib.js"
export { pool, dataDir, loadTable, weightedOf, verdictOf, verdictRow }

let store = null
export async function emails() {
    store ??= await ensureEmailStore(dataDir, join(dataDir, "agent"), () => {})
    return store
}
export const closeEmails = () => { store?.close(); store = null }

const RAW_HDR = /^\s*(Received|Return-Path|X-[\w-]+|Message-ID|Mime-Version|MIME-Version|Content-Type|Content-Transfer-Encoding|Content-Disposition|Delivered-To|In-Reply-To|References|Thread-Topic|Thread-Index|DKIM-Signature|charset=|boundary=)\s*[:=]/i
const DISCLAIMER = /(this (e-?mail|message)( and any attachments?)? (is|are|may be) (confidential|intended)|intended (only )?for the (sole )?use of|if you (are not|have received) (the intended|this (e-?mail|message|communication) in error)|unsubscribe|to be removed from|privileged and confidential|copyright|all rights reserved)/i

// Structure of one email and the location of the answer evidence in it.
export function anatomy(email, record) {
    const { header, body } = splitFile(email)
    const head = parseFileHeader(header)
    const seg = segmentBody(body)
    const lines = seg.lines
    const segOf = new Array(lines.length).fill(1)
    const isHdr = new Array(lines.length).fill(false)
    for (const m of seg.messages) {
        for (let i = m.headerStart; i <= m.headerEnd; i++) { segOf[i] = m.index; isHdr[i] = true }
        for (let i = m.bodyStart; i <= m.bodyEnd; i++) segOf[i] = m.index
    }
    const answers = [record.gold, ...(record.alternates ?? [])]
    const novel = new Set(novelAnswerWords(answers, record.question))
    // best 3-line window by novel-word coverage; the file header counts as region "hdr"
    const cover = (text) => { if (!novel.size) return 0; const w = contentWords(text); let n = 0; for (const x of w) if (novel.has(x)) n++; return n / novel.size }
    let best = { cov: cover(header), region: "file-header", line: -1 }
    for (let i = 0; i < lines.length; i++) {
        const win = lines.slice(i, i + 3).join("\n")
        const c = cover(win)
        if (c > best.cov + 1e-9) best = { cov: c, region: null, line: i }
    }
    let offset = 0
    if (best.line >= 0) {
        const s = segOf[best.line]
        const quoted = /^\s*>/.test(lines[best.line])
        best.region = isHdr[best.line] ? `seg-hdr` : s === 1 ? (quoted ? "top-quoted" : "top") : `embedded`
        best.seg = s
        offset = header.length + lines.slice(0, best.line).join("\n").length
    }
    const rawHdrLines = lines.filter((l) => RAW_HDR.test(l)).length
    const quotedLines = lines.filter((l) => /^\s*>/.test(l)).length
    return {
        chars: email.length, bodyChars: body.length, nMsgs: seg.messages.length, kinds: seg.messages.slice(1).map((m) => m.kind),
        nRecip: head.recipients.length, rawHdrLines, quotedLines, disclaimer: DISCLAIMER.test(body),
        novel: novel.size, evCov: Math.round(best.cov * 100) / 100, evRegion: best.region, evSeg: best.seg ?? 0,
        evOffset: offset, evRel: Math.round((offset / Math.max(1, email.length)) * 100) / 100,
    }
}

export const DEV_SETS = ["S300-1", "S300-2", "S300-3", "FULL-1", "FULL-0"]
