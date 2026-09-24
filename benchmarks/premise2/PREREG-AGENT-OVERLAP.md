# Exploratory agent word-overlap extension — frozen September 24, 2026

This extension asks whether repeated SEARCH/OPEN actions recover evidence missed
by one-shot word overlap. It is exploratory and does not alter the existing V2,
agent, index-factor, or one-shot manifests. Only the new overlap agent episodes
are generated. Existing `A-agent` BM25 episodes are paired comparators.

## Population and order

Use the 600 TEST questions and order in `agent-items.json`. Run small 600, mid
600, large core 200, large remaining 400, then tiny 600. The core is enriched
for BM25 misses; a complete core contrast is weighted by `trueShares` to the
selected 600. A full 600 contrast uses the selected 600 without core weighting.
Tiny (Gemma 3 1B) is a cross-generation exploratory diagnostic. Generation
stops by 2026-09-24 18:00 America/New_York; grading/reporting by 19:00.

## Only experimental change: SEARCH ranking

The corpus is the 103,368 emails in the frozen BM25 `corpus.sqlite`. For each
agent SEARCH query, use `contentWords` on the query and on the same searchable
fields as BM25: subject, sender, recipients, and body. Each distinct shared
word contributes one point, without term frequency, IDF, field or length
weighting. Return at most ten positive-score emails, sorted by descending
score and then ascending path (binary string order). Empty/no-match queries
return no results. Do not fill with zero-score emails. This differs from the
one-shot five-email budget fallback and matches BM25's empty/no-match behavior.

Everything else uses the existing `runEpisode` protocol: same first message,
five SEARCH/OPEN rounds, snippets, OPEN content, forced answer, model options,
and model digests. Use an `overlap` index id in episode keys. No gold answer,
relevance label, or BM25 rank enters SEARCH.

## Isolation and analysis

Store generation under `agent-overlap-run`, and Mac verdicts under
`agent-overlap-grading`. Bind resume to the corpus content, tokenizer/ranker
code, frozen question order, protocol, options, model digests, and Ollama
version. Rebuild the posting index in memory on each start. Save every completed
episode; transient Ollama outages do not consume failure attempts.

For each model, compare final graded accuracy with its existing ordinary-BM25
`A-agent` answers on identical questions. Report generated and graded paired
denominators, both arm accuracies, paired difference and mailbox-cluster 95%
interval. A partial prefix is descriptive only. Also show surfaced evidence,
rounds, protocol failures, latency, and available energy. Count technical or
no-answer terminal episodes as incorrect; leave judge-pending episodes pending.
Reuse J1/J2 verdicts only for identical answer/reference keys and adjudication
only when the shown-evidence key also matches. This is a total agent-plus-index
effect, not an isolated ranking effect.

As a secondary exploratory analysis, pair the overlap agent with the completed
one-shot word-overlap answers on identical questions. This compares whole
policies with different prompts and search budgets; it cannot isolate the
causal effect of repeated SEARCH actions.

## Operational gates

Mac and Windows preflight compare indexed rankings with a direct scan on saved
queries, and confirm index RSS <= 1.5 GB and search p95 <= 500 ms. Only one GPU
generator may run. A deadline-bounded chat call cannot write a partial scored
episode; interrupted work resumes from the last saved episode. Two independent
reviewers inspect code and checks before the Windows run.

## Deviation log

Before generation, the independent review identified two clarifications: the
secondary one-shot comparison above was added to address the opening research
question, and preflight now requires the Mac-frozen BM25 corpus content hash
`62f735923a0b55dacc05212ff8eec2c590c45d1176efb71548af13ebba3fc3f3`.
Neither changes generated episodes or the primary BM25-agent comparator.
