import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './client';

async function migrate(): Promise<void> {
  const pool = getPool();
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Migration completed successfully');
  } finally {
    client.release();
    await closePool();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
