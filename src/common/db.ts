import PgPromise from "pg-promise";

import { config } from "../config";
import { getIamToken } from './aws';

export const pgp = PgPromise();

// Override to handle bigint as number
pgp.pg.types.setTypeParser(20, function (value) {
  return parseInt(value);
});

interface DBUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const parseUrl = (url: string) : DBUrl => {
  const urlObj = new URL(url);
  return {
    host: urlObj.hostname,
    port: Number(urlObj.port || 5432),
    user: urlObj.username,
    password: urlObj.password,
    database: urlObj.pathname.substring(1),
  }
}

const databaseUrlPgOptions = (url: string) => {
  const databaseUrl = parseUrl(url);
  return {
    host: databaseUrl.host,
    port: databaseUrl.port,
    user: databaseUrl.user,
    database: databaseUrl.database,
    password : async () => {
      return  databaseUrl.password ? databaseUrl.password :
        await getIamToken({
          host: databaseUrl.host,
          port: databaseUrl.port,
          user: databaseUrl.user,
          region: process.env.AWS_REGION,
        });
    }
  };
}

export const getDatabaseUrlWithPassword = async (url: string | undefined) => {
  if (!url) {
    return url;
  }

  const urlObj = new URL(url);

  if (urlObj.password) {
    return url;
  }

  const token = await getIamToken({
    host: urlObj.hostname,
    port: Number(urlObj.port || 5432),
    user: urlObj.username,
    region: process.env.AWS_REGION,
  });

  urlObj.password = encodeURIComponent(token);
  return urlObj.toString();
}

export const db = pgp({
  ...databaseUrlPgOptions(config.postgresUrl),
  keepAlive: true,
  max: 1000,
  connectionTimeoutMillis: 10 * 1000,
  query_timeout: 10 * 1000,
  statement_timeout: 10 * 1000,
  allowExitOnIdle: true,
});
