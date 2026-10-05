# p: one-shot perfecter (exploration phase 2, round 2)

Mission: best ONE-SHOT pipeline for e2b (fixed retrieval + one reading call + the abstain retry; CPU retrieval models allowed), building on r5 (gates + cross-encoder slot-5 swap from the asker's mailbox BM25 top 30).

Code: `explore2/variants/p-perfect.js` (`buildContexts` shared by variants and the simulator; `pdense` diagnostic), tools `explore2/tools/p-ce.js` (CE score cache, std / snippet text), `p-sim.js` (AB recall per slot + deterministic end-to-end simulation), `p-common.js`.

