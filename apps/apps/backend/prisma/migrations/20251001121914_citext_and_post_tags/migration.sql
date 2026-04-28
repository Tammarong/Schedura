-- ------------------------------------------------------------------
-- Normalize users.username/email back to VARCHAR (no citext needed)
-- This works whether current type is citext or varchar.
-- ------------------------------------------------------------------
ALTER TABLE "users"
  ALTER COLUMN "username" TYPE VARCHAR(50)  USING "username"::text,
  ALTER COLUMN "email"    TYPE VARCHAR(100) USING "email"::text;

-- ------------------------------------------------------------------
-- Ensure posts.tags exists (string array for tag filtering)
-- ------------------------------------------------------------------
ALTER TABLE "posts"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';

-- Optional performance index for tag filters (?tags=...)
CREATE INDEX IF NOT EXISTS "posts_tags_gin" ON "posts" USING GIN ("tags");
