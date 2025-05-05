-- Up Migration

CREATE TABLE "balances" (
  "owner_chain_id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "currency_chain_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "available_amount" NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK ("available_amount" >= 0),
  "locked_amount" NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK ("locked_amount" >= 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "balances"
  ADD CONSTRAINT "balances_pk"
  PRIMARY KEY ("owner_chain_id", "owner", "currency_chain_id", "currency");

CREATE INDEX "balances_created_at_index"
  ON "balances" ("created_at");

CREATE INDEX "balances_updated_at_index"
  ON "balances" ("updated_at");

CREATE TYPE "balance_lock_source_t" AS ENUM (
  'deposit',
  'withdrawal'
);

CREATE TABLE "balance_locks" (
  "id" TEXT NOT NULL,
  "source" "balance_lock_source_t" NOT NULL,
  "owner_chain_id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "currency_chain_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" NUMERIC(78, 0) NOT NULL CHECK ("amount" >= 0),
  "expiration" INT,
  "executed" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "balance_locks"
  ADD CONSTRAINT "balance_locks_pk"
  PRIMARY KEY ("id");

CREATE INDEX "balance_locks_created_at_index"
  ON "balance_locks" ("created_at");

CREATE INDEX "balance_locks_updated_at_index"
  ON "balance_locks" ("updated_at");

-- Down Migration