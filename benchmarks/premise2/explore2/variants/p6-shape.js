// Worker p6 (round 6): prompt shape at large n, behind det(), with a placebo arm.
// Notes: docs/premise-study/explore2/p6.md
//
// The sandwich prompt (question before and after the emails) is the one shape change that
// moved hit reading (+3.2; gold-only 88.6 -> 91.5). Mechanism: causal attention, so email
// tokens are encoded knowing the question only if the question precedes them. gemma4 e2b
// also has sliding-window layers (n_swa = 512, i.md): in those layers an email token sees
// the question only if the question lies within the previous 512 tokens. In the sandwich
// the rules block (~65 tokens) sits between the leading question and the emails.
//
// Shapes (every arm is one generate call, same tokens except as stated):
//   sandwich  intro, Question, Rules, Emails, Question, Answer   (gates / oracles; parent)
//   o4        intro, Question, Emails, Rules, Question, Answer   (o-reading.js rulesLastPrompt)
//   qadj      intro, Rules, Question, Emails, Question, Answer   (new: the question moves next
//             to the emails, the rules stay first; isolates "question adjacent to the emails"
//             from o4's "rules next to the answer")
//   pad       sandwich + a content-free line of periods, about as many tokens as the rules
//             block, between the rules and the emails (placebo: shifts and re-encodes every
//             email and answer token like a reorder does, adds no information)
//
// Gold-only arms (hits only, misses "skipped" with no call; gold email alone; det(all)):
//   p6-g0 (= a6-det-oracle = oracles behind det), p6-g4, p6-gqa, p6-gpad
// End-to-end arms: gates (explore/variants.js, imported, unchanged) behind det(all) with every
//   sandwich answer prompt rebuilt in the arm's shape through a ctx proxy (prompts that do not
//   parse back byte for byte are left alone): p6-e4, p6-eqa, p6-epad.
import { ABSTAIN } from "../../prompts.js"
import { sandwichPrompt, VARIANTS as BASE } from "../../explore/variants.js"
import { det } from "./i-det.js"
import { parseSandwich } from "./c-agent.js"
import { rulesLastPrompt } from "./o-reading.js"

const INTRO = "You answer questions about a person's email archive using only the emails below."
export const RULES = `Rules:
- Answer every part of the question in one or two sentences. No preamble.
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- If the emails do not contain the answer, reply with exactly: ${ABSTAIN}`
const block = (emails) => `<<<EMAILS\n${emails.map((email, index) => `[${index + 1}]\n${email}`).join("\n\n")}\nEMAILS>>>`

// Placebo filler: periods, about the rules block's token count (RULES is 262 chars ~ 60-65
// tokens; ". " is one token). Checked on the smoke run's prompt token counts (p6.md).
export const FILLER = ". ".repeat(64).trim()

// Placebo 2 (added after S300-1: the period line re-rolled only 83/200 gold-only answers vs
// 113-134 for the reorders): the sandwich with its first two rule lines swapped. Same tokens,
// same question position, same distance from the question to the emails; only a reorder of
// two instruction lines, so it re-encodes everything after the rules like o4/qadj do.
export const RULES_SWAPPED = `Rules:
- Copy names, dates, numbers, amounts and URLs exactly as they appear in the emails.
- Answer every part of the question in one or two sentences. No preamble.
- If the emails do not contain the answer, reply with exactly: ${ABSTAIN}`

export const SHAPES = {
    sandwich: (question, emails) => sandwichPrompt(question, emails),
    perm: (question, emails) => sandwichPrompt(question, emails).replace(RULES, RULES_SWAPPED),
    o4: (question, emails) => rulesLastPrompt(question, emails),
    qadj: (question, emails) => `${INTRO}

${RULES}

Question: ${question}

Emails:
${block(emails)}

Question: ${question}
Answer:`,
    pad: (question, emails) => `${INTRO}

Question: ${question}

${RULES}

${FILLER}

Emails:
${block(emails)}

Question: ${question}
Answer:`,
}

// ---- gold-only harness (hits only) ----
const goldOnly = (shape) => async (ctx, record) => {
    if (record.stratum !== "hit") return { status: "skipped", answer: "", contextPaths: [record.path] }
    const result = await ctx.generate({ prompt: SHAPES[shape](record.question, [ctx.emailOf(record.path)]) })
    return { status: result.status, answer: result.answer ?? "", contextPaths: [record.path], readPaths: [record.path], shape }
}

// ---- end to end: rebuild every sandwich answer prompt of a wrapped pipeline ----
// generate({ prompt }) and single-user-message chatRaw (x1's commit answer with logprobs)
// are rewritten; tool turns, probes, picks and plans never parse as a sandwich.
export function shapeCtx(ctx, shape) {
    const stats = { rebuilt: 0, kept: 0 }
    const rebuild = (prompt) => {
        const parsed = parseSandwich(prompt)
        if (!parsed) { stats.kept++; return prompt }
        stats.rebuilt++
        return SHAPES[shape](parsed.question, parsed.emails)
    }
    const wrapped = Object.create(ctx)
    wrapped.generate = (args) => (args?.prompt ? ctx.generate({ ...args, prompt: rebuild(args.prompt) }) : ctx.generate(args))
    wrapped.chatRaw = (body) => {
        const m = body?.messages
        if (!body?.tools && Array.isArray(m) && m.length === 1 && m[0].role === "user") {
            const content = rebuild(m[0].content)
            if (content !== m[0].content) return ctx.chatRaw({ ...body, messages: [{ ...m[0], content }] })
        }
        return ctx.chatRaw(body)
    }
    wrapped.p6Stats = stats
    return wrapped
}

export const withShape = (run, shape) => async (ctx, record) => {
    const c = shapeCtx(ctx, shape)
    const out = await run(c, record)
    return { ...out, p6: { shape, ...c.p6Stats } }
}

const gates = (ctx, record) => BASE.gates.run(ctx, record)
const DET = { mode: "all" }

export const VARIANTS = {
    "p6-g0": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (gold-only, hits only): gold email alone, sandwich prompt (= oracles = a6-det-oracle), behind det(all)", run: det(goldOnly("sandwich"), DET) },
    "p6-g4": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (gold-only, hits only): gold email alone, o4 layout (question, emails, rules, question), behind det(all)", run: det(goldOnly("o4"), DET) },
    "p6-gqa": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (gold-only, hits only): gold email alone, rules first then the question next to the emails (rules, question, emails, question), behind det(all)", run: det(goldOnly("qadj"), DET) },
    "p6-gpad": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (gold-only, hits only, placebo): sandwich + a content-free line of periods (~ rules-block length) before the emails, behind det(all)", run: det(goldOnly("pad"), DET) },
    "p6-gperm": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (gold-only, hits only, placebo 2): sandwich with its first two rule lines swapped (same tokens and question position), behind det(all)", run: det(goldOnly("perm"), DET) },
    "p6-eperm": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (placebo 2): gates behind det(all) with the first two rule lines of its answer prompts swapped", run: det(withShape(gates, "perm"), DET) },
    "p6-e4": { version: 1, describe: "gates behind det(all) with its answer prompts in o4's layout (question, emails, rules, question)", run: det(withShape(gates, "o4"), DET) },
    "p6-eqa": { version: 1, describe: "gates behind det(all) with its answer prompts in the qadj layout (rules, question, emails, question)", run: det(withShape(gates, "qadj"), DET) },
    "p6-epad": { version: 1, diagnostic: true, describe: "DIAGNOSTIC (placebo): gates behind det(all) with a content-free line of periods (~ rules-block length) before the emails in its answer prompts", run: det(withShape(gates, "pad"), DET) },
}
