process.env.HTTP_PORT = "5001";
process.env.WS_PORT = "5002";

process.env.POSTGRES_URL =
  "postgresql://postgres:password@127.0.0.1:5432/postgres?schema=public";
process.env.RABBIT_URL = "amqp://guest:guest@127.0.0.1:5672";
process.env.REDIS_URL = "redis://default:password@127.0.0.1:6379";
