// Append-only JSONL stores with crash recovery, for answers, verdicts and markers.
//
// A generation is keyed by (model digest, options hash, prompt sha): an identical
// prompt in two cells is generated once and reused. Failures are recorded but never
// count as done, so a rerun retries them (up to MAX_FAILED_ATTEMPTS).

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { sha256 } from "./text.js"

export const MAX_FAILED_ATTEMPTS = 3

// Reads a JSONL file, skipping a torn line from a crash. Only the file's writer
// passes repair: true (it rewrites the file without the torn line, so its next
// append does not continue a broken record); readers such as `status` never
// rewrite, because a concurrent writer may be appending.
export function readJsonl(path, { repair = false } = {}) {
    if (!existsSync(path)) return { records: [], dropped: 0 }
    const records = []
    let dropped = 0
    for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue
        try {
            records.push(JSON.parse(line))
        } catch {
            dropped++
        }
    }
    if (dropped && repair) {
        const temporary = `${path}.${process.pid}.tmp`
        writeFileSync(temporary, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""))
        renameSync(temporary, path)
    }
    return { records, dropped }
}

export const appendJsonl = (path, record) => appendFileSync(path, JSON.stringify(record) + "\n")

// Atomic JSON write (temp file + rename), so a kill or power loss mid-write never
// leaves a torn state file behind.
export function writeJsonAtomic(path, value) {
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n")
    renameSync(temporary, path)
}

export const generationKey = (modelDigest, optionsHash, promptSha) => sha256(`${modelDigest}|${optionsHash}|${promptSha}`)
export const optionsHash = (options) => sha256(JSON.stringify(Object.keys(options).sort().map((key) => [key, options[key]])))

// A prompt that does not fit the shared context window fails identically on every
// retry and for every model; it is final at once and excluded from contrasts.
export const PERMANENT_FAILURES = new Set(["context_overflow"])

export class AnswerStore {
    constructor(path) {
        this.path = path
        this.done = new Map()
        this.failures = new Map()
        this.lastFailure = new Map()
        const { records, dropped } = readJsonl(path, { repair: true })
        this.recovered = dropped
        for (const record of records) if (record.type === "answer") this.track(record)
    }

    track(record) {
        if (record.status === "ok" || record.status === "output_limit" || record.status === "empty") this.done.set(record.key, record)
        else {
            this.failures.set(record.key, (this.failures.get(record.key) ?? 0) + 1)
            this.lastFailure.set(record.key, record)
        }
    }

    // A generation is final when it produced an answer (ok, or cut at the output
    // limit, or deliberately empty), when it failed permanently (context overflow),
    // or when it has failed too often to retry.
    has(key) {
        return this.done.has(key) || PERMANENT_FAILURES.has(this.lastFailure.get(key)?.status) || (this.failures.get(key) ?? 0) >= MAX_FAILED_ATTEMPTS
    }

    get(key) {
        return this.done.get(key) ?? null
    }

    // The last failed attempt of a generation that is final without an answer.
    finalFailure(key) {
        if (this.done.has(key) || !this.has(key)) return null
        return this.lastFailure.get(key) ?? null
    }

    add(record) {
        appendJsonl(this.path, { type: "answer", ...record })
        this.track(record)
    }
}

// Generation-affecting fingerprint; resume refuses to mix runs whose fingerprints
// differ. Git commit is deliberately NOT part of it (recorded per answer instead),
// so a code fix that leaves every hash unchanged can resume a run.
export function runFingerprint({ prepareManifest, modelDigests, options, ollamaVersion, preregHash }) {
    return sha256(JSON.stringify({
        questionSet: prepareManifest.hashes.questionSet,
        templates: prepareManifest.hashes.templates,
        representation: prepareManifest.hashes.representation,
        rStar: prepareManifest.retrieval.rStar,
        modelDigests,
        options,
        ollamaVersion,
        preregHash,
    }))
}
