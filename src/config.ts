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
  allowedOracles: process.env.ALLOWED_ORACLES
    ? process.env.ALLOWED_ORACLES.split(";")
    : undefined,

  onchainAllocator: process.env.ONCHAIN_ALLOCATOR,

  onchainAllocatorSenderAwsKmsKeyRegion:
    process.env.ONCHAIN_ALLOCATOR_SENDER_AWS_KMS_KEY_REGION,
  onchainAllocatorSenderAwsKmsKeyId:
    process.env.ONCHAIN_ALLOCATOR_SENDER_AWS_KMS_KEY_ID,
  onchainAllocatorSenderPk: process.env.ONCHAIN_ALLOCATOR_SENDER_PK,
};
