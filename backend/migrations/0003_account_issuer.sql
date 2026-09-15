-- Better Auth 1.7 stores an `issuer` on every account row: the stable namespace an
-- identity belongs to ("local:credential" for email+password, "local:oauth:<provider>"
-- or the real OIDC issuer for social logins). 0001 predates that column because the
-- email-OTP flow never wrote an account row at all — email+password does, so the column
-- has to exist before the first sign-up.
--
-- Backfill: any row written before this migration came from a local provider, so
-- "local:" || "providerId" reproduces what Better Auth would have written. In practice
-- the table is empty (OTP created none, and migrate-from-supabase.ts copies none).

ALTER TABLE "account" ADD COLUMN "issuer" TEXT;

UPDATE "account" SET "issuer" = 'local:' || "providerId" WHERE "issuer" IS NULL;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

-- Better Auth looks accounts up by (issuer, accountId) and expects that pair to be unique.
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account" ("issuer", "accountId");
