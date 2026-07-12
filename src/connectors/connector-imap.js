import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {createEntry} from "../entries.js";

// recent: if set, only fetch the newest N emails; omit to fetch the whole mailbox.
export async function run({ recent } = {}) { // !!! Optimize for larger mailboxes since it currently polls every email in normal run
    const client = new ImapFlow({
        host: process.env.IMAP_HOST ?? "imap.gmail.com",
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: true,
        auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD }
    });

    // ImapFlow emits 'error' on socket trouble; without a listener Node crashes the whole process. To fix it... (line below, idk why am i writing this comment, i guess i am just bored. hi... hello?... anyway...)
    client.on("error", (err) => console.error("IMAP error:", err.message));

    await client.connect();
    const sources = [];
    const lock = await client.getMailboxLock("INBOX");
    try {
        // Sequence numbers run oldest→newest, so the newest N is the tail of the range.
        // "1:*" = every message. Drain the raw messages fast here, then close the connection).


        // todo: buffers all sources in memory; fine for recent runs, revisit for full-mailbox.
        const total = client.mailbox.exists;
        const range = recent ? `${Math.max(1, total - recent + 1)}:*` : "1:*";
        for await (const msg of client.fetch(range, { source: true })) {
            sources.push(msg.source);
        }
    } finally {
        lock.release();
        await client.logout();
    }

    // Loop through the emails once they are all pooled, then loop through them.
    // createEntry dedupes on (source, externalId) to not waste compute on Ollama
    for (const source of sources) {
        if (process.env.DEBUG_LOGGING === 'true') {console.log("Processing / Sending to Ollama")}
        const mail = await simpleParser(source);
        try {
            await createEntry({
                content: mail.text,
                source: "email",
                externalId: mail.messageId,
                title: mail.subject,
                author: mail.from?.text,
                occurredAt: mail.date
            })
            console.log(mail.subject, "-", mail.from?.text);
        } catch (err) {
            // Duplicate (already ingested on a previous run) — the @@unique([source, externalId])
            // constraint rejects it. Skip and keep going; anything else is a real error.
            if (err.code === "P2002") continue;
            throw err;
        }
    }
}