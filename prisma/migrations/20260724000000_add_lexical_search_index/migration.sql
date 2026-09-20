CREATE INDEX "Entry_lexical_search_idx"
ON "Entry"
USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));
