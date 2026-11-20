import { readFile } from 'node:fs/promises';
import { pool, transaction } from './db.js';

try {
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(514032)');
    await db.query('CREATE TABLE IF NOT EXISTS migrations (version integer PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    const { rowCount } = await db.query('SELECT 1 FROM migrations WHERE version = 1');
    if (rowCount) return;
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO migrations (version) VALUES (1)');
  });
  console.log('Banco atualizado.');
} finally {
  await pool.end();
}
