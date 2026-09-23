// Index-side preprocessing (PREREG-AGENT-INDEX.md): the main study always indexed
// R0, so representation only ever changed what the model read. These variants
// change what is searched. Every variant uses the same FTS5 schema, tokenizer and
// query sanitiser as the main BM25 index; only the indexed text or the column
// weights differ. The email returned (and shown to the model) is always R0.
//
//   bm25          the main study's index (corpus.sqlite), all text columns weight 1
//   bm25-fields   same index, subject x3 and sender x2 at query time (no rebuild)
//   bm25-r1       body indexed as R1 safe-clean text (quoted-printable decoded,
//                 ">" quoting stripped, whitespace collapsed)
//   bm25-msg      one row per message (R2 segmentation, the message's own header
//                 lines kept); an email ranks by its best message
//   bm25-latest   body indexed as the newest message only (RL; lossy by design)
//
// The candidate order is the pre-registered tie-break order (simplest first).

import { existsSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { BM25_RANK, Bm25Pool, openBm25, mapLimit } from "./bm25.js"
import { splitFile, parseFileHeader, sha256 } from "./text.js"
import { cleanBodyR1 } from "./represent.js"
import { segmentBody, messageText, headerText } from "./segment.js"
import { ranksFor, LIST_DEPTH } from "./retrieve.js"

export const INDEX_VERSION = "premise2-indexes-v1"

export const INDEX_VARIANTS = {
    "bm25": { file: "corpus.sqlite" },
    "bm25-fields": { file: "corpus.sqlite", weights: [0, 0, 3, 2, 1, 1] },
    "bm25-r1": { file: "corpus-r1.sqlite", rows: "r1" },
    "bm25-msg": { file: "corpus-msg.sqlite", rows: "msg", collapse: true },
    "bm25-latest": { file: "corpus-latest.sqlite", rows: "latest" },
}
export const NEW_INDEX_CANDIDATES = ["bm25-fields", "bm25-r1", "bm25-msg", "bm25-latest"]

export const variantOptions = (name) => {
    const variant = INDEX_VARIANTS[name]
    if (!variant) throw new Error(`unknown index variant ${name}`)
    return { weights: variant.weights ?? null, collapse: Boolean(variant.collapse) }
}
export const variantPath = (dataDir, name) => join(dataDir, INDEX_VARIANTS[name].file)

// The indexed body rows of one email for a rebuilt variant.
export function bodyRows(kind, body) {
    if (kind === "r1") return [cleanBodyR1(body)]
    const segmented = segmentBody(body)
    if (kind === "latest") return [messageText(segmented, segmented.messages[0]).trim()]
    if (kind === "msg") {
        const rows = segmented.messages
            .map((message) => [headerText(segmented, message), messageText(segmented, message)].join("\n").trim())
            .filter(Boolean)
        return rows.length ? rows : [""]
    }
    throw new Error(`unknown row kind ${kind}`)
}

export function buildVariantIndex(name, docs, dataDir) {
    const variant = INDEX_VARIANTS[name]
    if (!variant.rows) return { built: false, reason: "shares corpus.sqlite" }
    const dbPath = variantPath(dataDir, name)
    if (existsSync(dbPath)) return { built: false, reason: "exists" }
    mkdirSync(dirname(dbPath), { recursive: true })
    const temporary = `${dbPath}.${process.pid}.tmp`
    rmSync(temporary, { force: true })
    const db = new DatabaseSync(temporary)
    db.exec(`
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        CREATE VIRTUAL TABLE docs USING fts5(
            path UNINDEXED, user UNINDEXED, subject, sender, recipients, content,
            tokenize='porter unicode61'
        );
    `)
    const insert = db.prepare("INSERT INTO docs VALUES (?, ?, ?, ?, ?, ?)")
    let rows = 0
    db.exec("BEGIN")
    for (const doc of docs) {
        const { header, body } = splitFile(doc.email)
        const parsed = parseFileHeader(header)
        const recipients = parsed.recipients.join(", ") || parsed.rawRecipients
        for (const content of bodyRows(variant.rows, body)) {
            insert.run(doc.path, doc.user, parsed.subject, parsed.sender, recipients, content)
            rows++
        }
    }
    db.exec("COMMIT")
    db.exec(`INSERT INTO docs(docs, rank) VALUES('rank', '${BM25_RANK}')`)
    db.exec("INSERT INTO docs(docs) VALUES('optimize')")
    db.close()
    renameSync(temporary, dbPath)
    return { built: true, rows }
}

export function buildAllVariants(docs, dataDir, log = () => {}) {
    const out = {}
    for (const name of Object.keys(INDEX_VARIANTS)) {
        const started = performance.now()
        out[name] = buildVariantIndex(name, docs, dataDir)
        if (out[name].built) log(`[index] ${name}: ${out[name].rows} rows in ${Math.round((performance.now() - started) / 1000)} s`)
    }
    return out
}

export const openVariant = (dataDir, name) => openBm25(variantPath(dataDir, name), variantOptions(name))

// Recall summary over ranks: answer-bearing recall@1/5/10 and strict recall@5.
export function recallSummary(rankList) {
    const n = rankList.length
    const at = (field, k) => (n ? rankList.filter((ranks) => ranks[field] !== null && ranks[field] <= k).length / n : null)
    return { n, answerR1: at("answer", 1), answerR5: at("answer", 5), answerR10: at("answer", 10), strictR5: at("strict", 5), relaxedR5: at("relaxed", 5) }
}

// The pre-registered choice: the candidate with the highest DEV answer-bearing
// recall@5 on the questions field; a tie keeps the earlier candidate.
export function chooseNewIndex(devRecall) {
    let best = null
    for (const name of NEW_INDEX_CANDIDATES) {
        const value = devRecall[name]?.answerR5
        if (value == null) continue
        if (!best || value > best.value + 1e-12) best = { name, value }
    }
    return best?.name ?? null
}

// Retrieval-only evaluation of every variant: DEV, TEST and retrieval-only pools on
// the questions field, DEV and TEST on the rephrased field. Selection uses DEV only.
export async function evaluateIndexes({ dataDir, evidence, log = console.log, variants = Object.keys(INDEX_VARIANTS) }) {
    const pools = JSON.parse(readFileSync(join(dataDir, "pools.json"), "utf8"))
    const frozen = new Map()
    const frozenPath = join(dataDir, "retrieval.jsonl")
    if (existsSync(frozenPath)) {
        for (const line of readFileSync(frozenPath, "utf8").split("\n")) {
            if (!line.trim()) continue
            const entry = JSON.parse(line)
            frozen.set(entry.questionKey, entry.lists?.["bm25|global|questions"] ?? null)
        }
    }
    const sets = [
        ["dev", "questions", pools.dev],
        ["test", "questions", pools.test],
        ["retrieval", "questions", pools.retrieval],
        ["dev", "rephrased", pools.dev.filter((record) => record.rephrased)],
        ["test", "rephrased", pools.test.filter((record) => record.rephrased)],
    ]
    const results = {}
    let reproduced = null
    for (const name of variants) {
        const path = variantPath(dataDir, name)
        if (!existsSync(path)) throw new Error(`${name}: ${path} is missing; run npm run premise2 -- index-build first`)
        const pool = new Bm25Pool(path, undefined, variantOptions(name))
        results[name] = {}
        const started = performance.now()
        try {
            for (const [poolName, field, records] of sets) {
                const lists = await mapLimit(records, 8, (record) => pool.search(field === "rephrased" ? record.rephrased : record.question, LIST_DEPTH))
                const ranks = records.map((record, index) => ranksFor(record, lists[index], evidence))
                results[name][`${poolName}|${field}`] = recallSummary(ranks)
                if (name === "bm25" && field === "questions" && frozen.size) {
                    reproduced ??= { compared: 0, identical: 0 }
                    records.forEach((record, index) => {
                        const reference = frozen.get(record.questionKey)
                        if (!reference) return
                        reproduced.compared++
                        if (JSON.stringify(reference) === JSON.stringify(lists[index].map((hit) => hit.path))) reproduced.identical++
                    })
                }
            }
        } finally {
            await pool.close()
        }
        log(`[index-eval] ${name}: DEV answer R@5 ${(results[name]["dev|questions"].answerR5 * 100).toFixed(1)}%, TEST ${(results[name]["test|questions"].answerR5 * 100).toFixed(1)}% (${Math.round((performance.now() - started) / 1000)} s)`)
    }
    const devRecall = Object.fromEntries(Object.entries(results).map(([name, entry]) => [name, entry["dev|questions"]]))
    const choice = chooseNewIndex(devRecall)
    return { version: INDEX_VERSION, createdAt: new Date().toISOString(), variants: INDEX_VARIANTS, candidates: NEW_INDEX_CANDIDATES, rule: "highest DEV answer-bearing recall@5 (questions field); ties keep the earlier candidate", choice, reproducedMainBm25: reproduced, results }
}

export function indexEvalMarkdown(out) {
    const pct = (value) => (value == null ? "–" : `${(value * 100).toFixed(1)}`)
    const lines = [
        "# Index-side preprocessing: retrieval-only recall",
        "",
        `Generated ${out.createdAt} (${out.version}). Answer-bearing recall (gold, twin or an email containing the answer) unless stated. Selection rule: ${out.rule}.`,
        "",
        `**DEV choice: \`${out.choice}\`**`,
        "",
    ]
    if (out.reproducedMainBm25) lines.push(`The \`bm25\` variant reproduced the main study's frozen top-20 lists exactly for ${out.reproducedMainBm25.identical}/${out.reproducedMainBm25.compared} questions.`, "")
    const columns = Object.keys(Object.values(out.results)[0] ?? {})
    for (const column of columns) {
        lines.push(`## ${column} (n = ${Object.values(out.results)[0][column].n})`, "", "| index | R@1 | R@5 | R@10 | strict R@5 |", "|---|---|---|---|---|")
        for (const [name, entry] of Object.entries(out.results)) {
            const row = entry[column]
            lines.push(`| ${name} | ${pct(row.answerR1)} | ${pct(row.answerR5)} | ${pct(row.answerR10)} | ${pct(row.strictR5)} |`)
        }
        lines.push("")
    }
    return lines.join("\n")
}

export function writeIndexEval(out, outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "index-eval.json"), JSON.stringify(out, null, 2) + "\n")
    writeFileSync(join(outDir, "index-eval.md"), indexEvalMarkdown(out) + "\n")
    return sha256(JSON.stringify(out.results))
}
