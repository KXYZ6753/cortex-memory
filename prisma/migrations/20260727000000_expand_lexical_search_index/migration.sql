DROP INDEX IF EXISTS "Entry_lexical_search_idx";

CREATE INDEX "Entry_lexical_search_idx"
ON "Entry"
USING GIN (
    to_tsvector(
        'english',
        coalesce(author, '') || ' ' ||
        coalesce(metadata->>'to', '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(content, '')
    )
);
