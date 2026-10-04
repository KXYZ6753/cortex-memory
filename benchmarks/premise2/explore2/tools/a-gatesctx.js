// gates' contexts recomputed from a pool record's stored BM25 lists (offline).
import { byHeaderRank } from "../../explore/variants.js"
export function gatesContextsOffline(record, used, emailOf) {
    const global = record.lists.global.slice(0, 5)
    const mailbox = byHeaderRank(record.question, record.lists.user.slice(0, 20), emailOf, { k: 5 })
    const switched = !global[0]?.startsWith(`${record.user}/`)
    const contexts = switched ? [mailbox, global] : [global, mailbox]
    return { contexts, switched, final: contexts[used - 1] }
}
