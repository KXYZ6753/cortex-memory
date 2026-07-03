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

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
        // Sequence numbers run oldest→newest, so the newest N is the tail of the range.
        // "1:*" = every message. createEntry dedupes on (source, externalId) before doing
        // any Ollama work, so re-runs are cheap and reading mail in Gmail never makes us miss it.
        const total = client.mailbox.exists;
        const range = recent ? `${Math.max(1, total - recent + 1)}:*` : "1:*";
        for await (const msg of client.fetch(range, { source: true })) {
            const mail = await simpleParser(msg.source);
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
    } finally {
        lock.release();
        await client.logout();
    }
}