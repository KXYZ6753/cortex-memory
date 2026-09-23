# The accepted abstract

Submitted and accepted for presentation. The paper is due Monday 5 October 2026. Its framing is fixed; the results decide how it is filled in.

> **Does Retrieval Engineering Offset Model Scale? A Controlled Study on Email Question Answering**
> Kerem Cakmak, Suleyman Vural\*
>
> Answering questions over enterprise email can be expensive: generally, the default path to higher accuracy is a larger generator, and inference cost scales with it. Email is also awkward material — messages are noisy, repetitive, and spread across threads. This raises a question: can better representation and retrieval buy the accuracy that would otherwise require a larger model? We report a work-in-progress controlled evaluation on EnronQA, a public enterprise-email benchmark of 103,638 emails with 528,304 question–answer pairs. The design varies three factors: email representation (original full text vs. preprocessed text), retrieval method (lexical BM25 vs. dense embeddings vs. hybrid lexical–dense), and two generator sizes (Gemma 4 e2b, Gemma 4 31b) with plans to extend to other model families. We report four outcomes per configuration: retrieval recall, answer correctness, energy consumption, and end-to-end response time. Separating retrieval recall from answer correctness distinguishes failures of evidence selection from failures of reasoning, and pairing both with energy consumption and time makes the trade-off explicit rather than assumed. The contribution is a reproducible harness and a direct answer to one question: at what point does the small-model, better-retrieval configuration match the large-model baseline, and what does it cost? Our aim is to show that email preprocessing and retrieval engineering can close the gap to larger models, making the computation cheap enough to run on everyday devices while keeping data private without sacrificing accuracy or speed.
>
> \*Corresponding author

## Promise by promise: what was actually measured (V2)

| the abstract says | what V2 did | note for the paper |
|---|---|---|
| EnronQA, 103,638 emails, 528,304 QA pairs | full corpus indexed (103,368 emails; 270 over 40k chars dropped); questions sampled: DEV 397, TEST 955, retrieval-only 2,000 | state the sample sizes and the mailbox-level tuning/evaluation split |
| representation: original vs preprocessed | R0 original, R1 safe-clean, R2 thread segmentation with attribution lines (all audited lossless); RL latest-message-only and RV1 (V1's lossy cleaning) as controls | "preprocessed" became three variants; the lossy one explains V1's −4 pts |
| retrieval: BM25 vs dense vs hybrid | BM25 (FTS5), dense (nomic-embed-text), RRF-60 hybrid; plus MiniLM rerank and an adaptive k gate | BM25 won clearly on this data |
| two generator sizes, Gemma 4 e2b and 31b | Gemma 4 e2b-it-qat and 31b-it-qat, plus e4b-it-qat as a midpoint and Gemma 3 1b-it-qat as a distraction amplifier | a four-point scale curve is more than promised; the 1b is a different generation (Gemma 3), so it is kept out of the scale-curve fit |
| "plans to extend to other model families" | not done; stays future work | |
| four outcomes: recall, correctness, energy, time | all four, per configuration | energy is CPU package + GPU only (a lower bound); time is hardware-specific (the 31b is 77% on CPU) |
| separate evidence-selection failures from reasoning failures | oracle (gold email) and floor (no email) controls; distraction cells; strict / relaxed / answer-bearing recall | the headline contrasts in results.md do exactly this |
| "at what point does small + better retrieval match the large baseline, and what does it cost?" | H1–H3, gap closure, the engineering ladder, cost per correct answer | the answer: only at (near-)perfect retrieval; see results.md |
| aim: show preprocessing and retrieval engineering close the gap | **not supported as tested**: tuned k/order/representation did not close it (gap closure ≈ 0) | the honest reframing is in paper-notes.md; the agent arm tests whether model-driven search does better |
