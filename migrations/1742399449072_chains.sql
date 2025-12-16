-- Up Migration

CREATE TYPE "vm_type_t" AS ENUM (
  'bitcoin-vm',
  'ethereum-vm',
  'hyperliquid-vm',
  'lighter-vm',
  'solana-vm',
  'sui-vm',
  'ton-vm',
  'tron-vm'
);

CREATE TABLE "chains" (
  "id" TEXT NOT NULL,
  "vm_type" "vm_type_t" NOT NULL,
  "depository" TEXT,
  "metadata" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "chains"
  ADD CONSTRAINT "chains_pk"
  PRIMARY KEY ("id");

CREATE INDEX "chains_created_at_index"
  ON "chains" ("created_at");

CREATE INDEX "chains_updated_at_index"
  ON "chains" ("updated_at");

-- Down Migration