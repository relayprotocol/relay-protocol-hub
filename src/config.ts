export const config = {
  httpPort: Number(process.env.HTTP_PORT!),

  postgresUrl: process.env.POSTGRES_URL!,

  ecdsaPrivateKey: process.env.ECDSA_PRIVATE_KEY!,
};
