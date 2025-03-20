-- Up Migration

CREATE TABLE "transaction_entries" (
  "chain_id" BIGINT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "owner_chain_id" BIGINT NOT NULL,
  "owner_address" TEXT NOT NULL,
  "currency_address" TEXT NOT NULL,
  "balance_diff" NUMERIC(78, 0) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "transaction_entries"
  ADD CONSTRAINT "transaction_entries_pk"
  PRIMARY KEY ("chain_id", "transaction_id", "entry_id");

CREATE INDEX "transaction_entries_created_at_index"
  ON "transaction_entries" ("created_at");

CREATE INDEX "transaction_entries_updated_at_index"
  ON "transaction_entries" ("updated_at");

-- Down Migration