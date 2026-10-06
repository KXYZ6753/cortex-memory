// Worker m: shared offline helpers.
import { readFileSync } from "node:fs"
// Diagnostic rows (status "diagnostic" is not in latestAnswers): questionKey -> { answer }.
export function diagRows(set, variant = "m-diag") {
    const out = new Map()
    for (const line of readFileSync(".data/premise2/explore/answers.jsonl", "utf8").split("\n")) {
        if (!line.includes(`"variant":"${variant}"`) || !line.includes(`"set":"${set}"`)) continue
        const row = JSON.parse(line)
        if (row.variant === variant && row.set === set) out.set(row.questionKey, { answer: row })
    }
    return out
}
