// Worker m: shared helpers (no variants here). Question name extraction for
// sender/recipient-filtered mailbox search.

const NOT_NAMES = new Set(("what who whom whose when where which why how according in on at the a an and or of for to from by with is are was were did does do "
    + "enron ect ees ena ews hou corp com net org mail email emails subject sender re fw fwd "
    + "january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday "
    + "inc llc ltd co company corporation group team office department").split(/\s+/))

// Lower-case tokens of the mailbox owner's name as it appears in the question:
// the user id's last name ("kitchen-l" -> kitchen) plus the capitalised word right before it.
export function ownerTokens(question, user) {
    const last = String(user).split("-")[0].toLowerCase()
    const out = new Set([last])
    const words = question.split(/\s+/)
    words.forEach((w, i) => {
        if (w.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "") === last || w.toLowerCase().replace(/[^a-z]/g, "") === last) {
            const prev = words[i - 1]?.replace(/[^A-Za-z]/g, "")
            if (prev && /^[A-Z][a-z]+$/.test(prev)) out.add(prev.toLowerCase())
        }
    })
    return out
}

// Capitalised words of the question that look like person names (not the first word,
// not the owner, not acronyms or common capitalised words); possessives stripped.
export function questionNames(question, user) {
    const own = ownerTokens(question, user)
    const out = []
    const words = question.replace(/["“”()]/g, " ").split(/\s+/).filter(Boolean)
    words.forEach((raw, i) => {
        if (i === 0) return
        const w = raw.replace(/'s$|’s$/, "").replace(/[^A-Za-z]/g, "")
        if (!/^[A-Z][a-z]{2,}$/.test(w)) return
        const lw = w.toLowerCase()
        if (NOT_NAMES.has(lw) || own.has(lw)) return
        if (!out.includes(lw)) out.push(lw)
    })
    return out
}
