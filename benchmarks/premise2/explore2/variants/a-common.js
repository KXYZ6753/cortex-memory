// Shared pieces for worker `a` (agent & hybrid) variants. No VARIANTS export.
import { byHeaderRank, sandwichPrompt } from "../../explore/variants.js"
import { isAbstain } from "../../prompts.js"
import { contentWords, normaliseForMatch } from "../../text.js"

// gates (explore/variants.js gatedMailbox with onAbstain + sandwich), reimplemented
// so the contexts and the context actually used are available to later steps.
export async function gatesCore(ctx, record) {
    const global = (await ctx.search(record.question, 20)).slice(0, 5)
    const mailboxRanked = await ctx.search(record.question, 20, record.user)
    const mailbox = byHeaderRank(record.question, mailboxRanked.slice(0, 20), ctx.emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const contexts = switched ? [mailbox, global] : [global, mailbox]
    const prompt = (paths) => sandwichPrompt(record.question, paths.map((path) => ctx.emailOf(path)))
    let result = await ctx.generate({ prompt: prompt(contexts[0]) })
    let used = 1
    while (used < contexts.length && contexts[used].length && result.status === "ok" && isAbstain(result.answer)) {
        result = await ctx.generate({ prompt: prompt(contexts[used]) })
        used++
    }
    return { result, contexts, used, final: contexts[used - 1], switched, global, mailboxRanked, mailbox }
}

// The email of `paths` holding the largest share of the answer's novel content words
// (words not in the question); ties go to the better-ranked email. null when the
// answer has no novel words.
export function attribute(answer, question, paths, emailOf) {
    const q = new Set(contentWords(question))
    const words = contentWords(answer).filter((word) => !q.has(word))
    if (!words.length) return null
    let best = null
    paths.forEach((path, index) => {
        const lower = normaliseForMatch(emailOf(path))
        const share = words.filter((word) => lower.includes(word)).length / words.length
        if (!best || share > best.share) best = { path, index, share }
    })
    return best
}

export const ok = (result) => result.status === "ok" || result.status === "output_limit"
