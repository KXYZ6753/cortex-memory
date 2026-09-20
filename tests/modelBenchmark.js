import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { cleanMailText } from "../src/connectors/connector-imap.js";
import { buildPrompt, schema } from "../src/process/ollama.js";

const OLLAMA_URL = "http://localhost:11434";
const MAX_CHARS = 4000;
const emailCount = Math.max(0, Number(process.env.BENCH_EMAILS ?? 3));
const contextSize = Math.max(1024, Number(process.env.BENCH_CONTEXT) || 2048);
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["qwen3.5:2b"];

function nextWeekday(day) {
    const date = new Date();
    date.setUTCHours(12, 0, 0, 0);
    const distance = (day - date.getUTCDay() + 7) % 7 || 7;
    date.setUTCDate(date.getUTCDate() + distance);
    return date.toISOString().slice(0, 10);
}

const syntheticCases = [
    {
        text: "Confirming the dentist next Tuesday at 3pm. Also car insurance is due Friday.",
        check: (value) => value.events.length >= 2
            && [nextWeekday(2), nextWeekday(5)].every((date) => value.events.some((event) => event.date === date))
            && ["dentist", "insurance"].every((word) => value.events.some((event) => event.title.toLowerCase().includes(word))),
    },
    {
        text: "CONGRATULATIONS! Claim your free gift card now. Click this link before the offer disappears!",
        check: (value) => value.importance === 1 && value.events.length === 0,
    },
    {
        text: "Urgent: we detected an unauthorized $4,200 wire transfer. Call your bank's known fraud number immediately.",
        check: (value) => value.importance >= 4,
    },
    {
        text: "Your interview is confirmed for August 14, 2026 at 10:00 AM. Please arrive fifteen minutes early.",
        check: (value) => value.events.some((event) => event.date === "2026-08-14"),
    },
    {
        text: "Thanks for sending the notes. I read them and everything looks good.",
        check: (value) => value.events.length === 0,
    },
    {
        text: "You attended the Cortex project kickoff on July 3, 2026.",
        check: (value) => value.events.some((event) => event.date === "2026-07-03" && /cortex|project|kickoff/i.test(event.title)),
    },
    {
        text: "Submit the signed apartment lease by September 2, 2026. Copyright 2026 Example Properties.",
        check: (value) => value.events.length === 1 && value.events[0].date === "2026-09-02" && /lease/i.test(value.events[0].title),
    },
];

async function fetchRecentEmails() {
    if (!emailCount) return [];
    const client = new ImapFlow({
        host: process.env.IMAP_HOST ?? "imap.gmail.com",
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: true,
        auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
        logger: false,
    });
    const texts = [];
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
        const total = client.mailbox.exists;
        if (!total) return texts;
        const range = `${Math.max(1, total - emailCount + 1)}:*`;
        for await (const message of client.fetch(range, { source: true })) {
            const mail = await simpleParser(message.source, { skipTextToHtml: true, keepCidLinks: true });
            const text = cleanMailText(mail.text) || mail.subject?.trim();
            if (text) texts.push(text.slice(0, MAX_CHARS));
        }
    } finally {
        lock.release();
        await client.logout();
    }
    return texts;
}

async function extract(model, text) {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [{ role: "user", content: buildPrompt(text) }],
            format: schema,
            stream: false,
            think: false,
            keep_alive: "10m",
            options: { temperature: 0, num_ctx: contextSize, num_predict: 512 },
        }),
        signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const data = await response.json();
    return { value: JSON.parse(data.message.content), data };
}

function structurallyValid(value) {
    return typeof value?.summary === "string"
        && Number.isInteger(value.importance) && value.importance >= 1 && value.importance <= 5
        && Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string")
        && Array.isArray(value.events) && value.events.every((event) => typeof event?.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date));
}

const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;
const ms = (nanoseconds) => Math.round((nanoseconds || 0) / 1e6);

async function unload(model) {
    await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0, stream: false }),
    });
}

const realEmails = await fetchRecentEmails();
console.log(JSON.stringify({ contextSize, synthetic: syntheticCases.length, realEmails: realEmails.length }));

for (const model of models) {
    await unload(model);
    const cases = [...syntheticCases, ...realEmails.map((text) => ({ text }))];
    const timings = [];
    let valid = 0;
    let checksPassed = 0;
    let checksTotal = 0;
    const failedChecks = [];
    const invalidCases = [];
    let errors = 0;
    let coldLoadMs = 0;
    let evalTokens = 0;
    let evalNanoseconds = 0;

    for (const [index, testCase] of cases.entries()) {
        try {
            const { value, data } = await extract(model, testCase.text);
            if (structurallyValid(value)) valid++;
            else invalidCases.push({ case: index + 1, value });
            if (testCase.check) {
                checksTotal++;
                if (structurallyValid(value) && testCase.check(value)) checksPassed++;
                else {
                    failedChecks.push({ case: index + 1, value });
                }
            }
            if (index === 0) coldLoadMs = ms(data.load_duration);
            else timings.push(ms(data.total_duration));
            evalTokens += data.eval_count || 0;
            evalNanoseconds += data.eval_duration || 0;
        } catch (error) {
            errors++;
            console.error(JSON.stringify({ model, case: index + 1, error: error.message.slice(0, 160) }));
        }
    }

    console.log(JSON.stringify({
        model,
        valid: `${valid}/${cases.length}`,
        invalidCases,
        labeledChecks: `${checksPassed}/${checksTotal}`,
        failedChecks,
        errors,
        coldLoadMs,
        warmMedianMs: median(timings),
        outputTokensPerSecond: evalNanoseconds ? Number((evalTokens / (evalNanoseconds / 1e9)).toFixed(1)) : 0,
    }));
    await unload(model);
}
