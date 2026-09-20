-- Replace free-text sentiment with a numeric importance rating (1-5; 1 = spam/junk, 5 = critical).
ALTER TABLE "Entry" DROP COLUMN "sentiment";
ALTER TABLE "Entry" ADD COLUMN "importance" INTEGER;
