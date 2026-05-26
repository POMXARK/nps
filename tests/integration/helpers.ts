import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

export function createTestPool(): Pool {
  return new Pool({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME     ?? 'nps_test',
    user:     process.env.DB_USER     ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  });
}

export async function runMigrations(pool: Pool): Promise<void> {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../src/infrastructure/db/schema.sql'),
    'utf-8',
  );
  await pool.query(sql);
}

export async function clearTables(pool: Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE user_channel_preferences, user_quiet_hours, global_policies RESTART IDENTITY CASCADE
  `);
}
