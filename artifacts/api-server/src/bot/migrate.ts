/**
 * Auto-migration: creates all required bot tables if they don't exist.
 * Called at startup — safe to run against an already-initialised DB.
 * Uses CREATE TABLE IF NOT EXISTS so it is idempotent.
 */

import { getPool } from '@workspace/db';
import { logger }  from '../lib/logger.js';

const DDL = `
CREATE TABLE IF NOT EXISTS bot_users (
  chat_id    BIGINT PRIMARY KEY,
  username   TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  banned     BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS bot_licenses (
  key              TEXT PRIMARY KEY,
  duration_ms      BIGINT      NOT NULL,
  created_by       BIGINT      NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_by      BIGINT,
  redeemed_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  notified_expiry  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS bot_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_call_logs (
  id         SERIAL PRIMARY KEY,
  chat_id    BIGINT      NOT NULL,
  username   TEXT,
  mode       TEXT        NOT NULL DEFAULT 'call',
  phone      TEXT        NOT NULL,
  call_sid   TEXT,
  status     TEXT        NOT NULL DEFAULT 'initiated',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    logger.info('No DATABASE_URL — skipping migrations, running in-memory mode');
    return;
  }
  try {
    await pool.query(DDL);
    logger.info('DB migrations applied (tables ready)');
  } catch (e) {
    logger.warn({ e }, 'DB migration failed — bot will run in in-memory mode');
  }
}
