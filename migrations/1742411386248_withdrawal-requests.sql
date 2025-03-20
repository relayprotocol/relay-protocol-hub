-- Up Migration

CREATE TABLE "withdrawal_requests" (
  "id" TEXT NOT NULL,
  "owner_chain_id" BIGINT NOT NULL,
  "owner_address" TEXT NOT NULL,
  "chain_id" BIGINT NOT NULL,
  "currency_address" TEXT NOT NULL,
  "amount" NUMERIC(78, 0) NOT NULL,
  "recipient_address" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "executed" BOOLEAN NOT NULL DEFAULT FALSE,
  "signature" TEXT NOT NULL,
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