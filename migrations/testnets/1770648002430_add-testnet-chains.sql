-- Up Migration

INSERT INTO chains (
  id,
  vm_type,
  depository,
  metadata
) VALUES (
  'sepolia',
  'ethereum-vm',
  '0x5Feab8dB4534F9F7E2669Bb260c57a01aD1c12e3',
  '{"chainId": 11155111}'::jsonb
) ON CONFLICT (id) DO NOTHING;

INSERT INTO chains (
  id,
  vm_type,
  depository,
  metadata
) VALUES (
  'base-sepolia',
  'ethereum-vm',
  '0x5Feab8dB4534F9F7E2669Bb260c57a01aD1c12e3',
  '{"chainId": 84532}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Down Migration

DELETE FROM chains 
WHERE id IN ('sepolia', 'base-sepolia');
