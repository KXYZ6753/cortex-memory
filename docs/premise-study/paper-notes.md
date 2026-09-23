# Paper notes

Working notes for writing the paper, due Monday 5 October 2026. They are grounded in `results.md`.

## The honest headline

The abstract hoped to show that preprocessing and retrieval engineering close the gap to larger models. As tested, they do not: gap closure is −0.26 [−1.40, 0.21], and H2 non-inferiority is inconclusive at 5 points (−4.8 [−6.9, −2.8]). The stronger, supported finding is different and still answers the abstract's question ("at what point does small + better retrieval match large, and what does it cost?"):

1. **The reader gap is small.** Given the right email, e2b scores 96.3% and the 31b 98.2% (+1.8).
2. **The retrieval gap is large, and the same for both models.** Retrieval failure costs 6–8 points. BM25 misses cost both models the same ~4.7 points; only dilution differs by scale (2.9 vs 1.7).
3. **The crossover sits at retrieval quality, not model size.** A 2B model with perfect retrieval beats a 31B model with real BM25 retrieval: 96.3 vs 91.8, +4.5 [2.0, 7.1].
4. **What it costs.** At baseline, the 31b spends ~23× the time and ~19× the energy per correct answer, for +3.8 points.
5. **What engineering does and does not buy.**
   - Tuning k, ordering and representation does not buy the missing points.
   - Plain BM25 beats dense, hybrid and reranked retrieval on this data.
   - Thread-attribution rendering (R2) is a clean null.
   - Engineering helps only the weakest reader (1b: +7.2).
6. **Small models are more distractible** (S1: +5.3). The mechanism is mostly dilution (the fact gets lost among other emails) rather than capture (copying a distractor), except for the 1b.

**Suggested framing:** "Retrieval engineering does not offset model scale, but it does not need to: scale matters much less than retrieval. What separates a 2B from a 31B answer is mostly whether the right email was retrieved."

The agent arm, if it runs in time, tests the natural next question: can the small model fix its own retrieval by writing its own queries?

## Robustness notes to state

- **H1** is SUPERIOR under adjudicated scoring but not robust under strict consensus and span scoring. Say so.
- **E\*** was selected on DEV and failed to transfer to TEST (DEV +1.5 → TEST −1.1). This is a result, not an embarrassment: it shows pre-registration working.
- **Noise floor:** a prompt-perturbation flip rate of 2.0–2.7%. Interpret small deltas against it.
- **Judging:**
  - three judge families;
  - the adjudicator rescued 20% of consensus-INCORRECT answers;
  - quotes are machine-verified;
  - drift is 0.5%;
  - no human labels. This is a limitation, mitigated by adjudication plus the span anchor.
- **Grading host deviation:** TEST grading ran on OpenRouter rather than Ollama Cloud (same J1/J2 models, different host). Recorded in the PREREG deviation log.

## Figures and tables to make

1. Recall by method (answer-bearing R@1/3/5/10/20) and by scope. BM25 > RRF > rerank > dense.
2. Accuracy by model × context: floor, oracle, B, E\*, distractors. The scale curve 47.9 / 87.5 / 90.5 / 91.8 against the oracle curve.
3. The money figure: a Pareto plot of accuracy vs joules per correct answer (log x), with marker size for latency and one point per model × {oracle, B, E\*}.
4. The crossover: the e2b oracle line above the 31b B line, with the retrieval-loss decomposition (recall miss vs dilution) as stacked bars per model.
5. Distraction: the induced-error rate by model, split into capture, dilution and abstention.
6. Tables:
   - the main confirmatory results (H1–H3, gap closure);
   - the secondary family;
   - corpus and pool statistics with exclusions;
   - hardware and software;
   - one-off costs (embedding ~2 h on the Mac; prepare ~50 min).

## Limitations to state

- A single dataset (EnronQA) of old, English, corporate email. EnronQA's questions are generated and name entities from the gold email, which inflates lexical retrieval; that partly explains BM25's dominance. Rephrased questions cost 4 points.
- A single model family (Gemma); the 1b is a different generation (Gemma 3).
- Judge-based grading without a human audit.
- Energy is a lower bound (CPU package + GPU; no DRAM, board or PSU), and timing is hardware-specific: the 31b is mostly on CPU with 8 GB of VRAM.
- The sample: 955 TEST questions (the 31b answered 600).
- An ethics and privacy paragraph: real people's mail, and the on-device privacy motivation.

## Keep consistent with the abstract

- **Representation:** the abstract says original vs preprocessed. We have R0 plus three preprocessed variants (R1 safe, R2 attribution, RL and RV1 lossy). Present R0 vs R1/R2 as the lossless comparison and the lossy variants as controls that show where V1's loss came from.
- **Scale:** the abstract names two generator sizes. We add e4b and 1b as extra points and keep the e2b vs 31b contrast primary.
- **Other families:** "plans to extend to other model families" stays as future work.
