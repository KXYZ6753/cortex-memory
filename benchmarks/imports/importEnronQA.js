import { writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { prisma } from "../../src/db/client.js"
import { createEntry } from "../../src/entries.js"
import { cleanMailText } from "../../src/connectors/connector-imap.js"

const count = Number(process.argv[2] ?? 100)
if (!Number.isInteger(count) || count < 1) throw new Error("Count must be a positive integer")

const rows = []
for (let offset = 0; offset < count; offset += 100) {
    const length = Math.min(100, count - offset)
    const url = new URL("https://datasets-server.huggingface.co/rows")
    url.search = new URLSearchParams({
        dataset: "MichaelR207/enron_qa_0922",
        config: "default",
        split: "test",
        offset: String(offset),
        length: String(length),
    })

    let response
    for (let attempt = 0; attempt < 6; attempt++) {
        response = await fetch(url)
        if (response.status !== 429 && response.status < 500) break
        const waitMs = 5000 * 2 ** attempt
        console.warn(`[download] HTTP ${response.status}; retrying in ${waitMs / 1000}s`)
        await delay(waitMs)
    }
    if (!response.ok) throw new Error(`EnronQA download failed: ${response.status} ${await response.text()}`)
    const page = (await response.json()).rows
    if (!Array.isArray(page) || page.length !== length) throw new Error(`Expected ${length} EnronQA rows at offset ${offset}`)
    rows.push(...page)
    console.log(`[download] ${rows.length}/${count}`)
    if (rows.length < count) await delay(1000)
}

const cases = []
try {
    for (const { row } of rows) {
        const email = row?.email
        const question = row?.questions?.[0]
        if (!email || !question || !row.path) throw new Error("EnronQA row is missing email, question, or path")

        await createEntry({
            content: email,
            processingContent: cleanMailText(email) || email,
            source: "enronqa",
            externalId: row.path,
            title: email.match(/^Subject:\s*(.*)$/m)?.[1]?.trim() || null,
            author: email.match(/^Sender:\s*(.*)$/m)?.[1]?.trim() || null,
        })
        cases.push({ query: question, relevantIds: [row.path] })
        console.log(`[import] ${cases.length}/${count} (${Math.round(cases.length / count * 100)}%) ${row.path}`)
    }

    await writeFile("tests/enronqaCases.json", JSON.stringify(cases, null, 2) + "\n")
    console.log(`[complete] Imported ${cases.length} emails and questions`)
} finally {
    await prisma.$disconnect()
}
