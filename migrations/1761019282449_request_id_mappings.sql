-- Up migration
CREATE TABLE "request_id_mappings" (
  "chain_id" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY ("wallet", "nonce")
);

CREATE INDEX "idx_request_id_mappings_request_id" ON "request_id_mappings" ("request_id");
CREATE INDEX "idx_request_id_mappings_wallet" ON "request_id_mappings" ("wallet");

-- Down migration