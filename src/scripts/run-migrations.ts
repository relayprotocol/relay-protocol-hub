// wrapper for node-pg-migrate to inject the database password
import { spawnSync } from 'node:child_process';
import { getDatabaseUrlWithPassword } from '../common/db'

(async () => {
  process.env.POSTGRES_URL = await getDatabaseUrlWithPassword(String(process.env.POSTGRES_URL));

  spawnSync(
    'node-pg-migrate',
    process.argv.slice(2),
    { stdio: 'inherit' }
  );
})();
