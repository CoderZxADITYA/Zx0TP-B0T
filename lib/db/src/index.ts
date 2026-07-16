/**
 * Optional Drizzle DB connection.
 * Does NOT throw if DATABASE_URL is absent — returns null instead.
 * All call-sites must check for null before using db/pool.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function init(): ReturnType<typeof drizzle<typeof schema>> | null {
  if (_db) return _db;
  const url = process.env["DATABASE_URL"];
  if (!url) return null;
  try {
    _pool = new Pool({ connectionString: url });
    _db   = drizzle(_pool, { schema });
    return _db;
  } catch {
    return null;
  }
}

/** Returns the Drizzle client, or null when DATABASE_URL is not set. */
export function getDb() {
  return init();
}

export * from "./schema/index.js";
