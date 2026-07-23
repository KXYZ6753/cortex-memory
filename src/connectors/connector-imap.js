import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {createEntry} from "../entries.js";
import { prisma } from "../db/client.js";

export function cleanMailText(text) {
    // ponytail: strips html-to-text's link appendix; keep it only if URL search becomes useful.
    return typeof text === "string"
        ? text.replace(/\n[^\n]*References:\n1:[\s\S]*$/, "").replace(/https?:\/\/\S+/gi, "[link]").trim()
        : "";
}

// recent: if set, only fetch the newest N emails; omit to fetch the whole mailbox.
// todo: Change default behavior
export async function run({ recent } = {}) { //todo: !!! Optimize for larger mailboxes since it currently polls every email in normal run
    const client = new ImapFlow({
        host: process.env.IMAP_HOST ?? "imap.gmail.com",
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: true,
        auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD }
    });

    client.on("error", (err) => console.error("IMAP error:", err.message));

    await client.connect();
    const sources = [];
    const lock = await client.getMailboxLock("INBOX");
    try {
        // Sequence numbers run oldest→newest, so the newest N is the tail (end) of the range.


        const messages = [];
        const total = client.mailbox.exists;
        const range = recent ? `${Math.max(1, total - recent + 1)}:*` : "1:*";
        for await (const msg of client.fetch(range, { uid: true, envelope: true })) {
            messages.push(msg);
        }

        const existingIds = new Set((await prisma.entry.findMany({
            where: { source: "email", externalId: { not: null } },
            select: { externalId: true },
        })).map((entry) => entry.externalId));
        const unseen = messages.filter((msg) => !msg.envelope?.messageId || !existingIds.has(msg.envelope.messageId));

        if (unseen.length) {
            const messageIds = new Map(unseen.map((msg) => [msg.uid, msg.envelope?.messageId]));
            for await (const msg of client.fetch(unseen.map((msg) => msg.uid), { source: true }, { uid: true })) {
                sources.push({ source: msg.source, externalId: messageIds.get(msg.uid) });
            }
        }
    } finally {
        lock.release();
        await client.logout();
    }

    // ponytail: serial is 11% faster on the target M4; raise only after benchmarking another Ollama setup.
    const concurrency = Math.max(1, Number(process.env.INGEST_CONCURRENCY) || 1);
    const failures = [];
    let processed = 0;
    let skipped = 0;
    for (let i = 0; i < sources.length; i += concurrency) {
        await Promise.all(sources.slice(i, i + concurrency).map(async ({ source, externalId }) => {
            try {
                if (process.env.DEBUG_LOGGING === 'true') {console.log("Processing / Sending to Ollama")}
                const mail = await simpleParser(source, {
                    skipTextToHtml: true,
                    keepCidLinks: true,
                });
                const content = mail.text?.trim() ? mail.text : mail.subject?.trim();
                if (!content) {
                    skipped++;
                    return;
                }
                await createEntry({
                    content,
                    processingContent: cleanMailText(content) || content,
                    source: "email",
                    externalId: externalId ?? mail.messageId,
                    title: mail.subject,
                    author: mail.from?.text,
                    occurredAt: mail.date
                })
                processed++;
                console.log(mail.subject, "-", mail.from?.text);
            } catch (err) {
                // @@unique([source, externalId]) rejects races; any other code is a real error.
                if (err.code === "P2002") {
                    skipped++;
                    return;
                }
                failures.push(err)
                console.error(`Email ingestion failed; it will be retried next run: ${err.message}`)
            }
        }));
    }

    if (failures.length) {
        throw new AggregateError(failures, `${failures.length} email${failures.length === 1 ? "" : "s"} failed after retries; ${processed} processed, ${skipped} skipped`)
    }
    return { processed, skipped, failed: 0 }
}
