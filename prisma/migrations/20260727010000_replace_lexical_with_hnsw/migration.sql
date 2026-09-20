-- BM25 now uses a separate SQLite FTS5 index. Keep PostgreSQL focused on vector search.
DROP INDEX IF EXISTS "Entry_lexical_search_idx";

CREATE INDEX "Entry_content_embedding_hnsw_idx"
ON "Entry"
USING hnsw ("contentEmbedding" vector_cosine_ops);
