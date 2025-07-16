export const config = {
  httpPort: Number(process.env.HTTP_PORT!),

  postgresUrl: process.env.POSTGRES_URL!,

  ecdsaPrivateKey: process.env.ECDSA_PRIVATE_KEY!,
  ed25519PrivateKey: process.env.ED25519_PRIVATE_KEY!,
  bitcoinPrivateKey: process.env.BITCOIN_PRIVATE_KEY!,
};
