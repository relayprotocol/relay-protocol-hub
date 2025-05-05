-- Up Migration

CREATE TABLE "onchain_entries" (
  "id" TEXT NOT NULL,
  "chain_id" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "balance_diff" NUMERIC(78, 0) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "onchain_entries"
  ADD CONSTRAINT "onchain_entries_pk"
  PRIMARY KEY ("id");

CREATE INDEX "onchain_entries_created_at_index"
  ON "onchain_entries" ("created_at");

CREATE INDEX "onchain_entries_updated_at_index"
  ON "onchain_entries" ("updated_at");

-- Down Migration