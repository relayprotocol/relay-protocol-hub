-- Up migration

CREATE TABLE "nonce_mappings" (
  "wallet_chain_id" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "signature_chain_id" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE "nonce_mappings"
  ADD CONSTRAINT "nonce_mappings_pk"
  PRIMARY KEY ("wallet_chain_id", "wallet", "nonce");

-- Down migration