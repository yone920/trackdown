-- Better Auth core tables.
--
-- Same shape My Read Coach generated with `npx @better-auth/cli generate` (better-auth
-- 1.6/1.7). The email-otp plugin stores codes in "verification"; the bearer plugin adds
-- no tables. Regenerate if the Better Auth config in src/auth.ts adds plugins or fields.
--
-- Quoted camelCase column names are Better Auth's convention — keep them quoted in any
-- SQL that touches these tables.
--
-- "user"."id" is TEXT, not UUID, on purpose: users migrated from Supabase keep their
-- auth.users UUID as their id (so every user_id FK in 0002 stays valid), while users
-- created after cutover get Better Auth's own generated ids.

create table "user" (
	"id" text not null primary key,
	"name" text not null,
	"email" text not null unique,
	"emailVerified" boolean not null,
	"image" text,
	"createdAt" timestamptz default CURRENT_TIMESTAMP not null,
	"updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create table "session" (
	"id" text not null primary key,
	"expiresAt" timestamptz not null,
	"token" text not null unique,
	"createdAt" timestamptz default CURRENT_TIMESTAMP not null,
	"updatedAt" timestamptz not null,
	"ipAddress" text,
	"userAgent" text,
	"userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
	"id" text not null primary key,
	"accountId" text not null,
	"providerId" text not null,
	"userId" text not null references "user" ("id") on delete cascade,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamptz,
	"refreshTokenExpiresAt" timestamptz,
	"scope" text,
	"password" text,
	"createdAt" timestamptz default CURRENT_TIMESTAMP not null,
	"updatedAt" timestamptz not null
);

create table "verification" (
	"id" text not null primary key,
	"identifier" text not null,
	"value" text not null,
	"expiresAt" timestamptz not null,
	"createdAt" timestamptz default CURRENT_TIMESTAMP not null,
	"updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
