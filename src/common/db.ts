import PgPromise from "pg-promise";

import { config } from "../config";

export const pgp = PgPromise();

// Override to handle bigint as number
pgp.pg.types.setTypeParser(20, function (value) {
  return parseInt(value);
});

export const db = pgp({
  connectionString: config.postgresUrl,
  keepAlive: true,
  max: 10,
  connectionTimeoutMillis: 10 * 1000,
  query_timeout: 10 * 1000,
  statement_timeout: 10 * 1000,
  allowExitOnIdle: true,
});
