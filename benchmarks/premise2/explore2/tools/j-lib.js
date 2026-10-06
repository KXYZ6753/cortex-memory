// Worker j: shared answer-shape patterns (offline tools and variants).
import { HEDGE } from "../variants/n-conf.js"

export const PATTERNS = {
    hedge: (t) => HEDGE.test(t),
    multiCand: (t) => /\b(several|multiple|three|two|four|different) (different )?(amounts|numbers|dates|times|names|people|values|emails|figures|prices|answers)\b|\bseveral\b.*\b(mention|list|show)/i.test(t),
    additionally: (t) => /\b(Additionally|also mentions?|also states?|also notes?)\b/i.test(t),
    sourceAttr: (t) => /\b(mentioned|stated|found|appears|indicated) in (the |an |both |several )?(email|emails)\b|\bemail \[\d\]|\[\d\]/i.test(t),
    emailRef: (t) => /\bemail \[\d\]|\[\d\]/.test(t),
    pronounYou: (t) => /\b(you|your|me|my|I)\b/.test(t.replace(/^.*?:/, "")),
    pathLeak: (t) => /\b[a-z]+-[a-z]\/[a-z_]+\//.test(t),
    question: (t) => /\?\s*$/.test(t),
    threeSent: (t) => (t.match(/[.!?](\s|$)/g) ?? []).length >= 3,
    long300: (t) => t.length > 300,
    quoteHeavy: (t) => (t.match(/"/g) ?? []).length >= 4,
    dateNumeric: (t) => /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(t),
    timeStamp: (t) => /\b\d{1,2}:\d{2}\s?(AM|PM|am|pm)\b/.test(t),
}
