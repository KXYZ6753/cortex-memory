// Exploratory, unweighted word-overlap comparator. Separate from the frozen V2
// and agent manifests so their existing runs remain resumable.
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { loadRaw, buildCorpus, HF_FILES } from "./dataset.js"
import { contentWords, parseFileHeader, sha256, splitFile } from "./text.js"
import { buildPrompt, promptRecord, TOKEN_CAP, TEMPLATE_HASH } from "./prompts.js"
import { MODELS, SMOKE } from "./cells.js"
import { chat, tags, version } from "./ollama.js"
import { AnswerStore, appendJsonl, generationKey, optionsHash, readJsonl, writeJsonAtomic, MAX_FAILED_ATTEMPTS, PERMANENT_FAILURES } from "./store.js"
import { judgeConfig, preGrade, verdictKey } from "./judge.js"

export const RANKER_VERSION = "distinct-content-word-overlap-all-corpus-budgeted-v3"
export const PHASES = { small600: ["small", 600], mid600: ["mid", 600], large200: ["large", 200], large600: ["large", 600], small955: ["small", 955], mid955: ["mid", 955] }
const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0
const iso = () => new Date().toISOString()
export const simpleDirOf = (dataDir) => process.env.POC2_SIMPLE_DIR ?? join(dataDir, SMOKE ? "simple-smoke" : "simple-run")
const fileSha = (path) => new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject)
})

// Same searchable fields as the BM25 FTS table. File: is deliberately absent.
export function searchableText(email) {
    const { header, body } = splitFile(email)
    const parsed = parseFileHeader(header)
    return [parsed.subject, parsed.sender, parsed.recipients.join(", ") || parsed.rawRecipients, body].join("\n")
}

// Process each email once; keep only five hits per question. The inverted query
// vocabulary is transient and contains no gold answers or relevance labels.
export function rankOverlap(records, docs, k = 5) {
    const queryWords = records.map((record) => contentWords(record.question))
    const wantedByWord = new Map()
    queryWords.forEach((words, index) => words.forEach((word) => {
        if (!wantedByWord.has(word)) wantedByWord.set(word, [])
        wantedByWord.get(word).push(index)
    }))
    const top = records.map(() => [])
    const sorted = [...docs].sort((a, b) => cmp(a.path, b.path))
    for (const doc of sorted) {
        const counts = new Map()
        for (const word of contentWords(searchableText(doc.email))) {
            for (const index of wantedByWord.get(word) ?? []) counts.set(index, (counts.get(index) ?? 0) + 1)
        }
        for (const [index, score] of counts) {
            const hits = top[index]
            if (hits.length === k && score <= hits[k - 1].score) continue
            const hit = { path: doc.path, score }
            let low = 0, high = hits.length
            while (low < high) {
                const middle = (low + high) >>> 1
                const other = hits[middle]
                if (other.score > score || (other.score === score && cmp(other.path, doc.path) < 0)) low = middle + 1
                else high = middle
            }
            hits.splice(low, 0, hit)
            if (hits.length > k) hits.pop()
        }
    }
    const firstPaths = sorted.slice(0, k).map((doc) => doc.path)
    return top.map((hits) => {
        for (const path of firstPaths) if (hits.length < k && !hits.some((hit) => hit.path === path)) hits.push({ path, score: 0 })
        return hits.sort((a, b) => b.score - a.score || cmp(a.path, b.path))
    })
}

// Defense in depth for the shared 15.5k token ceiling.
export function budgetedFive(record, ranked, emailByPath) {
    const paths = []
    const scores = []
    for (const hit of ranked) {
        const proposed = [...paths, hit.path]
        const prompt = buildPrompt({ question: record.question, paths: proposed, representation: "R0", template: "T2", emailByPath })
        if (promptRecord(prompt).tokensUpper > TOKEN_CAP) continue
        paths.push(hit.path)
        scores.push(hit.score)
        if (paths.length === 5) break
    }
    return { paths, scores }
}

// Exact global ranking over the SAME corpus as BM25. Keep a transient posting
// list only for words appearing in questions; score every matching email, sort
// by the frozen score/path rule, then walk down that ranking until five emails
// fit the common prompt cap. A long email remains eligible when it fits.
export function rankBudgetedCorpus(records, docs) {
    const sorted = [...docs].sort((a, b) => cmp(a.path, b.path))
    const shortest = sorted.map((doc, index) => ({ index, chars: doc.email.trim().length })).sort((a, b) => a.chars - b.chars || cmp(sorted[a.index].path, sorted[b.index].path)).slice(0, 16)
    const queries = records.map((record) => contentWords(record.question))
    const wanted = new Set(queries.flat())
    const postings = new Map([...wanted].map((word) => [word, []]))
    for (const [index, doc] of sorted.entries()) {
        for (const word of contentWords(searchableText(doc.email))) postings.get(word)?.push(index)
    }
    const maxChars = Math.floor((TOKEN_CAP - 64) * 2.2)
    return records.map((record, q) => {
        const counts = new Map()
        for (const word of queries[q]) for (const index of postings.get(word) ?? []) counts.set(index, (counts.get(index) ?? 0) + 1)
        const matched = [...counts].sort(([a, sa], [b, sb]) => sb - sa || cmp(sorted[a].path, sorted[b].path))
        const paths = [], scores = []
        let chars = buildPrompt({ question: record.question, paths: [""], representation: "R0", template: "T2", emailByPath: new Map([["", ""]]) }).length
        const consider = (index, score) => {
            const candidate = sorted[index]
            // 16 chars covers the added rank label and separators; verify below.
            const next = chars + candidate.email.trim().length + 16
            const remaining = 4 - paths.length
            const reserve = shortest.filter((entry) => entry.index !== index && !paths.includes(sorted[entry.index].path)).slice(0, remaining).reduce((sum, entry) => sum + entry.chars + 16, 0)
            if (next + reserve > maxChars) return false
            chars = next
            paths.push(candidate.path)
            scores.push(score)
            return paths.length === 5
        }
        for (const [index, score] of matched) if (consider(index, score)) break
        const beforeFallback = paths.length
        // Every unmatched email has score zero. Preserve the frozen path tie
        // order while skipping candidates that cannot leave room for five.
        if (paths.length < 5) for (let index = 0; index < sorted.length; index++) {
            if (counts.has(index) || paths.includes(sorted[index].path)) continue
            if (consider(index, 0)) break
        }
        return { paths, scores, fallbackCount: paths.length - beforeFallback }
    })
}

export function orderedTestRecords(pools, agentItems) {
    const byKey = new Map(pools.test.map((record) => [record.questionKey, record]))
    const first = agentItems.items.map(({ questionKey }) => {
        const record = byKey.get(questionKey)
        if (!record) throw new Error(`agent item ${questionKey} missing from TEST pool`)
        return record
    })
    if (new Set(first.map((record) => record.questionKey)).size !== first.length) throw new Error("duplicate agent item")
    const used = new Set(first.map((record) => record.questionKey))
    return [...first, ...pools.test.filter((record) => !used.has(record.questionKey))]
}

function sourceHashes(dataDir) {
    const mainState = read(join(dataDir, "run-state.json"))
    return {
        mainFingerprint: mainState.fingerprint,
        pools: sha256(readFileSync(join(dataDir, "pools.json"))),
        agentItems: sha256(readFileSync(new URL("./agent-items.json", import.meta.url))),
        corpusPinned: HF_FILES.corpus.sha256,
        ranker: RANKER_VERSION,
        rankerCode: sha256(rankBudgetedCorpus.toString() + searchableText.toString()),
        template: TEMPLATE_HASH,
    }
}

export async function prepareSimple({ dataDir, log = console.log }) {
    if (SMOKE && !process.env.POC2_SIMPLE_DIR) throw new Error("set POC2_SIMPLE_DIR for smoke runs so study data cannot be overwritten")
    const dir = simpleDirOf(dataDir)
    mkdirSync(dir, { recursive: true })
    const sources = sourceHashes(dataDir)
    const pools = read(join(dataDir, "pools.json"))
    const agentItems = read(new URL("./agent-items.json", import.meta.url))
    const records = orderedTestRecords(pools, agentItems)
    if (records.length !== 955 || agentItems.items.length !== 600 || agentItems.core !== 200) throw new Error("unexpected frozen question counts")
    const actualCorpusSha = await fileSha(join(dataDir, "hf", HF_FILES.corpus.file))
    if (actualCorpusSha !== HF_FILES.corpus.sha256) throw new Error("corpus parquet differs from the pinned V2 corpus")
    const raw = await loadRaw(join(dataDir, "hf"))
    const { docs } = buildCorpus(raw.corpus)
    const emailByPath = new Map(docs.map(({ path, email }) => [path, email]))
    const lists = rankBudgetedCorpus(records, docs)
    const items = records.map((record, index) => {
        const { paths, scores, fallbackCount } = lists[index]
        const prompt = promptRecord(buildPrompt({ question: record.question, paths, representation: "R0", template: "T2", emailByPath }))
        return { questionKey: record.questionKey, user: record.user, paths, scores, fallbackCount, promptSha: prompt.sha, prompt: prompt.text, tokensUpper: prompt.tokensUpper, overCap: prompt.tokensUpper > TOKEN_CAP }
    })
    const manifest = { version: 1, preparedAt: iso(), sources, questionHash: sha256(JSON.stringify(records.map(({ questionKey, question }) => [questionKey, question]))), itemsHash: sha256(JSON.stringify(items)), count: items.length, core: 200, selected: 600, allEmails: docs.length, fallbackQuestions: items.filter((item) => item.fallbackCount > 0).length, underFive: items.filter((item) => item.paths.length < 5).length, overCap: items.filter((item) => item.overCap).length }
    const manifestPath = join(dir, "manifest.json")
    if (existsSync(manifestPath)) {
        const old = read(manifestPath)
        if (sha256(JSON.stringify({ ...old, preparedAt: null })) !== sha256(JSON.stringify({ ...manifest, preparedAt: null }))) throw new Error("simple preparation changed; use a fresh sidecar directory, never overwrite a frozen run")
        log(`[simple-prepare] unchanged ${items.length} frozen items`)
        return old
    }
    writeFileSync(join(dir, "items.jsonl"), items.map((item) => JSON.stringify(item)).join("\n") + "\n")
    writeJsonAtomic(manifestPath, manifest)
    log(`[simple-prepare] froze ${items.length} items, ${manifest.overCap} over token cap, in ${dir}`)
    return manifest
}

export function loadSimple({ dataDir }) {
    const dir = simpleDirOf(dataDir)
    const manifest = read(join(dir, "manifest.json"))
    const items = readJsonl(join(dir, "items.jsonl")).records
    if (items.length !== manifest.count || sha256(JSON.stringify(items)) !== manifest.itemsHash) throw new Error("simple items do not match frozen manifest")
    if (JSON.stringify(sourceHashes(dataDir)) !== JSON.stringify(manifest.sources)) throw new Error("simple source fingerprint changed")
    return { dir, manifest, items }
}

export function phaseItems(items, phase) {
    const spec = PHASES[phase]
    if (!spec) throw new Error(`unknown simple phase ${phase}`)
    return { alias: spec[0], items: items.slice(0, SMOKE ? Math.min(spec[1], SMOKE.maxItems) : spec[1]) }
}

export async function runSimple({ dataDir, phase, stopAt, ollamaUrl = "http://localhost:11434", log = console.log }) {
    const { dir, manifest, items } = loadSimple({ dataDir })
    const { alias, items: selected } = phaseItems(items, phase)
    const stopTime = new Date(stopAt ?? "").getTime()
    if (!Number.isFinite(stopTime) || stopTime <= Date.now()) throw new Error("POC2_STOP_AT must be a future ISO time")
    const main = read(join(dataDir, "run-state.json"))
    let liveVersion, availableModels
    while (Date.now() < stopTime) {
        try {
            liveVersion = await version(ollamaUrl)
            availableModels = await tags(ollamaUrl)
            break
        } catch (error) {
            log(`[simple] Ollama preflight unavailable: ${error.message}; retrying in 30 s`)
            await delay(Math.min(30_000, Math.max(1, stopTime - Date.now())))
        }
    }
    if (!availableModels) throw new Error("simple deadline reached before Ollama preflight completed")
    const installed = new Map(availableModels.map((model) => [model.name, model]))
    const tag = MODELS[alias].tag
    const installedDigest = installed.get(tag)?.digest
    if (!installedDigest) throw new Error(`Ollama model ${tag} missing`)
    if (!SMOKE && (installedDigest !== main.provenance.digests[alias] || liveVersion !== main.provenance.ollamaVersion)) throw new Error(`model digest or Ollama version differs from the completed V2 run for ${alias}`)
    const digest = SMOKE ? `${installedDigest}#simple-smoke-${alias}` : installedDigest
    const options = main.provenance.options
    const optsHash = optionsHash(options)
    const fingerprint = sha256(JSON.stringify({ manifest: manifest.itemsHash, sources: manifest.sources, alias, digest, options, liveVersion }))
    const statePath = join(dir, `state-${alias}.json`)
    const state = existsSync(statePath) ? read(statePath) : {}
    if (state.fingerprint && state.fingerprint !== fingerprint) throw new Error("simple generation settings changed; refusing to mix answers")
    state.fingerprint = fingerprint
    state.phase = phase
    state.startedAt ??= iso()
    state.resumedAt = iso()
    state.optionsHash = optsHash
    state.digest = digest
    state.ollamaVersion = liveVersion
    writeJsonAtomic(statePath, state)
    const store = new AnswerStore(join(dir, "answers.jsonl"))
    const mainStore = new AnswerStore(join(dataDir, "answers.jsonl"))
    if (store.recovered) log(`[simple] recovered ${store.recovered} torn answer line(s)`)
    const markers = join(dir, "markers.jsonl")
    const marker = (kind, extra = {}) => appendJsonl(markers, { t: performance.timeOrigin + performance.now(), kind, at: iso(), phase, model: alias, cell: "X-overlap-k5", ...extra })
    let ready = false
    let completed = 0
    const blockId = `overlap:${alias}:${iso()}`
    marker("block-start", { blockId })
    const alive = () => version(ollamaUrl).then(() => true, () => false)
    const ensureReady = async () => {
        for (;;) {
            if (Date.now() >= stopTime) return false
            if (!(await alive())) {
                log("[simple] Ollama unavailable; retrying in 30 s without recording an answer failure")
                await delay(30_000)
                continue
            }
            const ping = await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options: { ...options, num_predict: 4 }, attempts: 1, timeoutMs: Math.min(120_000, Math.max(1000, stopTime - Date.now())) })
            if (ping.status !== "ok") {
                log(`[simple] model load/warmup ${ping.status}; retrying in 30 s without recording an answer failure`)
                await delay(30_000)
                continue
            }
            const warm = await chat({ url: ollamaUrl, model: tag, prompt: "Reply with OK.", options, attempts: 1, timeoutMs: Math.min(120_000, Math.max(1000, stopTime - Date.now())) })
            if (warm.status !== "ok") {
                log(`[simple] model warmup ${warm.status}; retrying in 30 s without recording an answer failure`)
                await delay(30_000)
                continue
            }
            ready = true
            marker("model-ready", { tag })
            return true
        }
    }
    for (const item of selected) {
        const key = generationKey(digest, optsHash, item.promptSha)
        if (store.has(key)) continue
        if (Date.now() >= stopTime) break
        if (item.overCap) {
            store.add({ key, model: alias, tag, digest, cellId: "X-overlap-k5", questionKey: item.questionKey, promptSha: item.promptSha, optionsHash: optsHash, status: "context_overflow", answer: "", wallMs: 0, excludedAtPrepare: true })
            continue
        }
        const old = mainStore.get(key)
        if (old) {
            store.add({ ...old, key, model: alias, cellId: "X-overlap-k5", questionKey: item.questionKey, reusedFromMain: true })
            completed++
            continue
        }
        if (!ready && !(await ensureReady())) break
        let result = await chat({ url: ollamaUrl, model: tag, prompt: item.prompt, options, timeoutMs: Math.min(900_000, Math.max(1000, stopTime - Date.now())), attempts: 1 })
        while (["http_error", "timeout"].includes(result.status) && !(await alive())) {
            ready = false
            marker("ollama-outage")
            if (!(await ensureReady())) break
            result = await chat({ url: ollamaUrl, model: tag, prompt: item.prompt, options, attempts: 1, timeoutMs: Math.min(900_000, Math.max(1000, stopTime - Date.now())) })
        }
        if (Date.now() >= stopTime && ["http_error", "timeout"].includes(result.status) && !(await alive())) break
        store.add({ key, model: alias, tag, digest, cellId: "X-overlap-k5", questionKey: item.questionKey, promptSha: item.promptSha, optionsHash: optsHash, ...result, startedAt: iso(), finishedAt: iso() })
        completed++
        state.lastSuccessAt = iso()
        if (completed % 25 === 0) {
            marker("checkpoint", { completedThisSession: completed })
            log(`[simple] ${phase}: ${completed} new or reused this session`)
            writeJsonAtomic(statePath, state)
        }
    }
    const status = simpleStatus({ dataDir, quiet: true })
    const arm = status.arms[phase]
    state.lastStop = { at: iso(), reason: arm.done === arm.target ? "complete" : Date.now() >= stopTime ? "time" : "incomplete", done: arm.done, target: arm.target }
    writeJsonAtomic(statePath, state)
    marker("block-end", { blockId })
    marker("stop", state.lastStop)
    log(`[simple] ${phase}: ${arm.done}/${arm.target} (${state.lastStop.reason})`)
    return state.lastStop
}

export function simpleStatus({ dataDir, quiet = false, log = console.log }) {
    const { dir, items, manifest } = loadSimple({ dataDir })
    const main = read(join(dataDir, "run-state.json"))
    const optsHash = optionsHash(main.provenance.options)
    const answers = readJsonl(join(dir, "answers.jsonl")).records.filter((row) => row.type === "answer")
    const done = finalSimpleAnswers(answers)
    const verdictPath = join(dataDir, "simple-grading", "verdicts.jsonl")
    const hasGrades = existsSync(verdictPath)
    const verdicts = hasGrades ? [...readJsonl(join(dataDir, "verdicts.jsonl")).records, ...readJsonl(verdictPath).records] : []
    const byJudge = new Map()
    for (const row of verdicts) if (row.type === "verdict" && row.verdict) byJudge.set(`${row.judge}|${row.judgeModel}|${row.verdictKey}`, row.verdict)
    const judges = hasGrades ? { j1: judgeConfig("j1"), j2: judgeConfig("j2"), adj: judgeConfig("adj") } : null
    const recordOf = hasGrades ? new Map(read(join(dataDir, "pools.json")).test.map((record) => [record.questionKey, record])) : null
    const graded = (item, answer) => {
        if (!hasGrades) return false
        if (answer.status === "context_overflow" || answer.terminalFailure || preGrade(answer)) return true
        const record = recordOf.get(item.questionKey)
        const references = [record.gold, ...(record.alternates ?? [])]
        const keyOf = (role) => verdictKey({ questionKey: item.questionKey, references, answer: answer.answer, judge: judges[role], promptSha: role === "adj" ? item.promptSha : null })
        const j1 = byJudge.get(`j1|${judges.j1.model}|${keyOf("j1")}`)
        const j2 = byJudge.get(`j2|${judges.j2.model}|${keyOf("j2")}`)
        const adj = byJudge.get(`adj|${judges.adj.model}|${keyOf("adj")}`)
        return Boolean(adj || (j1 && j2 && j1 === j2))
    }
    const failures = new Map()
    for (const row of answers) {
        if (!["ok", "empty", "output_limit"].includes(row.status) && !PERMANENT_FAILURES.has(row.status)) failures.set(row.key, (failures.get(row.key) ?? 0) + 1)
    }
    const arms = {}
    for (const [phase, [alias, target]] of Object.entries(PHASES)) {
        const statePath = join(dir, `state-${alias}.json`)
        const digest = SMOKE && existsSync(statePath) ? read(statePath).digest : main.provenance.digests[alias]
        const slice = items.slice(0, SMOKE ? Math.min(target, SMOKE.maxItems) : target)
        const pairs = slice.map((item) => [item, done.get(generationKey(digest, optsHash, item.promptSha))]).filter(([, row]) => Boolean(row))
        const rows = pairs.map(([, row]) => row)
        const state = existsSync(statePath) ? read(statePath) : {}
        arms[phase] = { done: rows.length, target: slice.length, graded: hasGrades ? pairs.filter(([item, answer]) => graded(item, answer)).length : null, reused: rows.filter((row) => row.reusedFromMain).length, excluded: rows.filter((row) => row.status === "context_overflow").length, terminalFailures: rows.filter((row) => row.terminalFailure).length, failedAttempts: slice.reduce((n, item) => n + (failures.get(generationKey(digest, optsHash, item.promptSha)) ?? 0), 0), lastSuccessAt: state.lastSuccessAt ?? null, lastStop: state.lastStop ?? null }
    }
    const result = { prepared: manifest.preparedAt, arms, lastAnswerAt: answers.at(-1)?.finishedAt ?? null }
    if (!quiet) for (const [phase, arm] of Object.entries(arms)) log(`[simple-status] ${phase}: ${arm.done}/${arm.target}, graded ${arm.graded ?? "Mac-only"}, reused ${arm.reused}, excluded ${arm.excluded}, terminal failures ${arm.terminalFailures}, failed attempts ${arm.failedAttempts}, last success ${arm.lastSuccessAt ?? "none"}, last stop ${arm.lastStop?.reason ?? "none"}`)
    return result
}

export function simpleUnits({ dataDir, recordByKey }) {
    const { dir, items } = loadSimple({ dataDir })
    const byKey = finalSimpleAnswers(readJsonl(join(dir, "answers.jsonl")).records.filter((row) => row.type === "answer"))
    const main = read(join(dataDir, "run-state.json"))
    const optsHash = optionsHash(main.provenance.options)
    return ["small", "mid", "large"].flatMap((alias) => {
        const statePath = join(dir, `state-${alias}.json`)
        const digest = SMOKE && existsSync(statePath) ? read(statePath).digest : main.provenance.digests[alias]
        return items.flatMap((item) => {
        const key = generationKey(digest, optsHash, item.promptSha)
        const answer = byKey.get(key)
        if (!answer || answer.model !== alias) return []
        return [{ cellId: "X-overlap-k5", role: "exploratory", tier: "A", alias, item, answer, answerKey: key, record: recordByKey.get(item.questionKey) }]
        })
    })
}

export function finalSimpleAnswers(records) {
    const done = new Map(), failures = new Map()
    for (const row of records) {
        if (row.type !== "answer") continue
        if (["ok", "empty", "output_limit"].includes(row.status)) done.set(row.key, row)
        else if (PERMANENT_FAILURES.has(row.status)) done.set(row.key, row)
        else {
            const entry = failures.get(row.key) ?? { count: 0, last: null }
            entry.count++
            entry.last = row
            failures.set(row.key, entry)
        }
    }
    for (const [key, entry] of failures) if (!done.has(key) && entry.count >= MAX_FAILED_ATTEMPTS) done.set(key, { ...entry.last, answer: "", terminalFailure: true })
    return done
}
