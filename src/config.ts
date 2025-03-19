export const config = {
  httpPort: Number(process.env.HTTP_PORT!),

  oracleHttpUrl: process.env.ORACLE_HTTP_URL!,
  oracleWsUrl: process.env.ORACLE_WS_URL!,

  postgresUrl: process.env.POSTGRES_URL!,
  rabbitUrl: process.env.RABBIT_URL!,
  redisUrl: process.env.REDIS_URL!,
};
