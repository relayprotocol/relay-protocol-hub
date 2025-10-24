-- Up migration
CREATE TABLE deposit_bindings (
  nonce TEXT NOT NULL,
  deposit_id TEXT NOT NULL,
  depositor TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (nonce, depositor)
);

CREATE INDEX idx_deposit_bindings_deposit_id ON deposit_bindings (deposit_id);
CREATE INDEX idx_deposit_bindings_depositor ON deposit_bindings (depositor);

-- Down migration