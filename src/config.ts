export const config = {
  httpPort: Number(process.env.HTTP_PORT!),
  postgresUrl: process.env.POSTGRES_URL!,

  ecdsaPrivateKey: process.env.ECDSA_PRIVATE_KEY!,
  ed25519PrivateKey: process.env.ED25519_PRIVATE_KEY!,

  apiKeys: process.env.API_KEYS
    ? Object.fromEntries(
        process.env.API_KEYS.split(";").map((apiKey) => {
          const [key, integrator] = apiKey.split(":");
          return [key, integrator];
        })
      )
    : undefined,

  onchainAllocator: process.env.ONCHAIN_ALLOCATOR,
  onchainAllocatorSenderPk: process.env.ONCHAIN_ALLOCATOR_SENDER_PK,
};
