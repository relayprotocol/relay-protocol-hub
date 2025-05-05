-- Up Migration

CREATE TABLE "withdrawal_requests" (
  "id" TEXT NOT NULL,
  "owner_chain_id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "chain_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" NUMERIC(78, 0) NOT NULL,
  "recipient" TEXT NOT NULL,
  "encoded_data" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "executed" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_pk"
  PRIMARY KEY ("id");

CREATE INDEX "withdrawal_requests_created_at_index"
  ON "withdrawal_requests" ("created_at");

CREATE INDEX "withdrawal_requests_updated_at_index"
  ON "withdrawal_requests" ("updated_at");

-- Down Migration