// Worker v6 (round 6): an independent, non-generative encoder as an answer selector. AUX: an
// encoder used to choose among e2b's own candidate answers is a new category (not a retrieval
// helper); whether it counts in the paper is Kerem's decision. The final answer is always one of
// e2b's own candidate texts; the encoder only chooses.
//
// Extractive QA (SQuAD 2.0, RoBERTa-base, int8 ONNX, CPU via transformers.js): the question is run
// over each evidence email in sliding windows; the top spans (start + end logit) of all windows form
// a distribution, and a candidate answer is scored by how much of that distribution it contains.
// NLI cross-encoder (DeBERTa-v3, int8 ONNX, CPU): premise = an email chunk, hypothesis = question +
// candidate answer; score = max over chunks of logit(entailment) - logit(contradiction).

import { env, AutoTokenizer, AutoModelForQuestionAnswering, AutoModelForSequenceClassification, Tensor } from "@huggingface/transformers"

export const MODEL_CACHE = ".data/models"
export const QA_MODEL = "onnx-community/roberta-base-squad2-ONNX"
export const NLI_MODEL = "Xenova/DeBERTa-v3-base-mnli-fever-anli"

// ---- text normalisation shared by the encoder scores and the lexical baselines ----
const STOP = new Set("a an the and or but of to in on at for from by with as is are was were be been being it its this that these those he she they them his her their there here what which who whom whose when where why how do does did done have has had not no yes i you we our your my me us than then so such into about over under per via also any all each other only just can could would should will shall may might must if else up out off very more most less least some".split(" "))
export const words = (text) => (String(text ?? "").toLowerCase().match(/[a-z0-9]+(?:[.'@-][a-z0-9]+)*/g) ?? [])
export const content = (text) => words(text).filter((w) => !STOP.has(w))
// Content words of the answer that are not in the question ("novel" words, as e/l used).
export const novel = (question, answer) => {
    const q = new Set(content(question))
    return content(answer).filter((w) => !q.has(w))
}

// Lexical grounding (l's baseline): share of the answer's novel words found in the evidence.
export function lexGround(question, answer, evidenceText) {
    const nv = [...new Set(novel(question, answer))]
    if (!nv.length) return 0
    const ev = new Set(words(evidenceText))
    return nv.filter((w) => ev.has(w)).length / nv.length
}

// A stronger lexical baseline ("question-proximity"): for each evidence window of W words, the share
// of the answer's novel words in it times the share of the question's content words in it; max over
// windows. It rewards an answer whose words sit next to the question's words, which is the cheap
// version of what an extractive reader does.
export function lexProx(question, answer, evidenceTexts, W = 60, step = 20) {
    const nv = [...new Set(novel(question, answer))]
    const qw = [...new Set(content(question))]
    if (!nv.length || !qw.length) return 0
    let best = 0
    for (const t of evidenceTexts) {
        const w = words(t)
        for (let s = 0; s < Math.max(1, w.length - W + step); s += step) {
            const win = new Set(w.slice(s, s + W))
            const a = nv.filter((x) => win.has(x)).length / nv.length
            if (!a) continue
            const q = qw.filter((x) => win.has(x)).length / qw.length
            best = Math.max(best, a * (0.5 + q))
        }
    }
    return best
}

// ---- extractive QA ----
export async function loadQA({ cacheDir = MODEL_CACHE, model = QA_MODEL, dtype = "q8", threads = Number(process.env.V6_THREADS ?? 4) } = {}) {
    env.cacheDir = cacheDir
    const tokenizer = await AutoTokenizer.from_pretrained(model)
    const qa = await AutoModelForQuestionAnswering.from_pretrained(model, { dtype, session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } })
    const special = tokenizer.encode("a", { add_special_tokens: true })
    const bos = special[0], eos = special[special.length - 1]
    const pad = tokenizer.pad_token_id ?? 1
    // RoBERTa: <s> q </s></s> ctx </s>; BERT/DeBERTa: [CLS] q [SEP] ctx [SEP] with token_type_ids
    const roberta = /roberta/i.test(qa.config?.model_type ?? "")
    const useTypes = !roberta && (qa.sessions?.model?.inputNames ?? qa.session?.inputNames ?? []).includes("token_type_ids")
    const ids = (text) => tokenizer.encode(text, { add_special_tokens: false })
    return {
        tokenizer,
        dispose: () => qa.dispose(),
        // spans over all evidence texts: [{ text, score, email, window }], plus per-window null scores
        async read(question, texts, { maxLen = 384, stride = 128, maxQ = 64, topPerWindow = 20, maxSpan = 30, batch = 8, maxWindowsPerText = 12 } = {}) {
            const q = ids(question).slice(0, maxQ)
            const room = maxLen - q.length - 4
            const step = room - stride
            const windows = []
            texts.forEach((text, email) => {
                const c = ids(text)
                let n = 0
                for (let s = 0; n < maxWindowsPerText; s += step, n++) {
                    windows.push({ email, offset: s, ctx: c.slice(s, s + room) })
                    if (s + room >= c.length) break
                }
            })
            const spans = []
            const nulls = []
            for (let b = 0; b < windows.length; b += batch) {
                const part = windows.slice(b, b + batch)
                const seqs = part.map((w) => (roberta ? [bos, ...q, eos, eos, ...w.ctx, eos] : [bos, ...q, eos, ...w.ctx, eos]))
                const qLen = roberta ? q.length + 3 : q.length + 2
                const L = Math.max(...seqs.map((s) => s.length))
                const inputIds = new BigInt64Array(part.length * L).fill(BigInt(pad))
                const mask = new BigInt64Array(part.length * L)
                const types = new BigInt64Array(part.length * L)
                seqs.forEach((s, i) => s.forEach((t, j) => { inputIds[i * L + j] = BigInt(t); mask[i * L + j] = 1n; if (j >= qLen) types[i * L + j] = 1n }))
                const feeds = { input_ids: new Tensor("int64", inputIds, [part.length, L]), attention_mask: new Tensor("int64", mask, [part.length, L]) }
                if (useTypes) feeds.token_type_ids = new Tensor("int64", types, [part.length, L])
                const out = await qa(feeds)
                const S = out.start_logits.data, E = out.end_logits.data
                part.forEach((w, i) => {
                    const base = i * L
                    const c0 = qLen, c1 = c0 + w.ctx.length // context token positions [c0, c1)
                    nulls.push(S[base] + E[base])
                    const top = (arr) => {
                        const idx = []
                        for (let k = c0; k < c1; k++) idx.push(k)
                        idx.sort((x, y) => arr[base + y] - arr[base + x])
                        return idx.slice(0, topPerWindow)
                    }
                    const ss = top(S), ee = top(E)
                    const cand = []
                    for (const si of ss) for (const ei of ee) if (ei >= si && ei < si + maxSpan) cand.push({ si, ei, score: S[base + si] + E[base + ei] })
                    cand.sort((x, y) => y.score - x.score)
                    for (const c of cand.slice(0, topPerWindow)) spans.push({ text: tokenizer.decode(w.ctx.slice(c.si - c0, c.ei - c0 + 1)).trim(), score: c.score, email: w.email, window: b + i })
                })
                out.start_logits.dispose?.(); out.end_logits.dispose?.()
            }
            spans.sort((x, y) => y.score - x.score)
            return { spans, nulls, windows: windows.length, format: roberta ? "roberta" : useTypes ? "bert+types" : "bert" }
        },
    }
}

// Share of a span's content words (all words if it has none) that the candidate contains.
export function cover(spanText, candidateWords) {
    let sw = content(spanText)
    if (!sw.length) sw = words(spanText)
    if (!sw.length) return 0
    return sw.filter((w) => candidateWords.has(w)).length / sw.length
}

// Candidate scores from one QA read. Distribution = softmax over the top K distinct spans (by text).
//   ef  : expected cover, sum_s p(s) * cover(s, c)
//   max : best span logit among spans the candidate covers >= 0.5 (-50 if none)
//   top1: cover of the single best span
export function qaScores(read, candidates, { K = 20, T = 1 } = {}) {
    const seen = new Set()
    const top = []
    for (const s of read.spans) {
        const key = s.text.toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        top.push(s)
        if (top.length >= K) break
    }
    const m = Math.max(...top.map((s) => s.score), -Infinity)
    const ex = top.map((s) => Math.exp((s.score - m) / T))
    const Z = ex.reduce((a, b) => a + b, 0) || 1
    return candidates.map((c) => {
        const cw = new Set(words(c))
        let ef = 0, mx = -50
        top.forEach((s, i) => {
            const cv = cover(s.text, cw)
            ef += (ex[i] / Z) * cv
            if (cv >= 0.5) mx = Math.max(mx, s.score)
        })
        return { ef, max: mx, top1: top.length ? cover(top[0].text, cw) : 0, best: top[0]?.text ?? "" }
    })
}

// ---- NLI cross-encoder ----
export async function loadNLI({ cacheDir = MODEL_CACHE, model = NLI_MODEL, dtype = "q8", threads = Number(process.env.V6_THREADS ?? 4) } = {}) {
    env.cacheDir = cacheDir
    const tokenizer = await AutoTokenizer.from_pretrained(model)
    const nli = await AutoModelForSequenceClassification.from_pretrained(model, { dtype, session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 } })
    const labels = nli.config.id2label
    const iE = Number(Object.keys(labels).find((k) => /entail/i.test(labels[k])))
    const iC = Number(Object.keys(labels).find((k) => /contra/i.test(labels[k])))
    return {
        tokenizer,
        dispose: () => nli.dispose(),
        // chunk evidence texts into ~chunkTokens pieces (by token ids), score each hypothesis against each chunk
        chunks(texts, { chunkTokens = 320, stride = 64, maxChunksPerText = 8 } = {}) {
            const out = []
            for (const text of texts) {
                const c = tokenizer.encode(text, { add_special_tokens: false })
                let n = 0
                for (let s = 0; n < maxChunksPerText; s += chunkTokens - stride, n++) {
                    out.push(tokenizer.decode(c.slice(s, s + chunkTokens)))
                    if (s + chunkTokens >= c.length) break
                }
            }
            return out
        },
        async score(premises, hypotheses, { batch = 8 } = {}) {
            // returns per hypothesis: max over premises of (E - C), and of log p(E)
            const pairs = []
            hypotheses.forEach((h, hi) => premises.forEach((p) => pairs.push({ hi, p, h })))
            const res = hypotheses.map(() => ({ margin: -Infinity, logpE: -Infinity }))
            for (let b = 0; b < pairs.length; b += batch) {
                const part = pairs.slice(b, b + batch)
                const inputs = tokenizer(part.map((x) => x.p), { text_pair: part.map((x) => x.h), padding: true, truncation: true, max_length: 512 })
                const out = await nli(inputs)
                const d = out.logits.data, C = out.logits.dims[1]
                part.forEach((x, i) => {
                    const row = Array.from(d.slice(i * C, i * C + C))
                    const mx = Math.max(...row)
                    const lse = mx + Math.log(row.reduce((s, v) => s + Math.exp(v - mx), 0))
                    const r = res[x.hi]
                    r.margin = Math.max(r.margin, row[iE] - row[iC])
                    r.logpE = Math.max(r.logpE, row[iE] - lse)
                })
                out.logits.dispose?.()
            }
            return res
        },
    }
}
