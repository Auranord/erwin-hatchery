import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

async function run(): Promise<void> {
  await migrate(db, { migrationsFolder });
  console.info('Database migrations completed.');
}

void run()
  .catch((error: unknown) => {
    console.error('Database migration failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
