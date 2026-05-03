import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config.js';

export const pool = new Pool({
  connectionString: config.DATABASE_URL
});

export const db = drizzle(pool);

export async function checkDatabaseHealth(): Promise<boolean> {
  const result = await pool.query('select 1 as ok');
  return result.rows[0]?.ok === 1;
}

export async function checkEggTypeCatalogHealth(): Promise<boolean> {
  const result = await pool.query('select exists(select 1 from egg_types) as ok');
  return result.rows[0]?.ok === true;
}


export async function ensureCoreSchema(): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      twitch_user_id text UNIQUE NOT NULL,
      twitch_login text,
      display_name text,
      avatar_url text,
      is_provisional boolean NOT NULL DEFAULT true,
      is_deleted boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      role text NOT NULL,
      created_by_user_id uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );


    CREATE UNIQUE INDEX IF NOT EXISTS roles_user_id_role_idx ON roles (user_id, role);

    CREATE TABLE IF NOT EXISTS admin_action_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id uuid NOT NULL REFERENCES users(id),
      target_user_id uuid REFERENCES users(id),
      action_type text NOT NULL,
      request_id text NOT NULL UNIQUE,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      session_token_hash text NOT NULL UNIQUE,
      csrf_state text,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
  `);
}
