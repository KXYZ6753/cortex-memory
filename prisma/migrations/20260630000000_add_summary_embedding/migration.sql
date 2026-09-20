-- Semantic search: embed the AI summary so "similar meaning" queries find entries by vector distance.
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Entry" ADD COLUMN "summaryEmbedding" vector(768);
-- ponytail: no ANN index yet — exact scan is fine at low row counts. Add HNSW when search gets slow.
