"use strict";

const crypto = require("node:crypto");

async function initializeDatabase(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site6_users (
      id UUID PRIMARY KEY,
      google_sub TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      steam_id64 CHAR(17) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function findUserById(pool, id) {
  const result = await pool.query("SELECT id, display_name FROM site6_users WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

async function registerOrAuthenticate(pool, googleIdentity, steamId64) {
  const connection = await pool.connect();

  try {
    await connection.query("BEGIN");
    const existing = await connection.query(
      "SELECT id, google_sub, steam_id64, display_name FROM site6_users WHERE google_sub = $1 OR steam_id64 = $2 FOR UPDATE",
      [googleIdentity.sub, steamId64],
    );

    if (existing.rows.length > 0) {
      const matchesBoth = existing.rows.length === 1 &&
        existing.rows[0].google_sub === googleIdentity.sub &&
        existing.rows[0].steam_id64 === steamId64;

      if (!matchesBoth) {
        await connection.query("ROLLBACK");
        return { conflict: true };
      }

      const user = existing.rows[0];
      await connection.query("COMMIT");
      return { conflict: false, user: { id: user.id, name: user.display_name } };
    }

    const displayName = String(googleIdentity.name || "Пользователь").trim().slice(0, 100);
    const inserted = await connection.query(
      `INSERT INTO site6_users (id, google_sub, email, display_name, steam_id64)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, display_name`,
      [crypto.randomUUID(), googleIdentity.sub, googleIdentity.email, displayName, steamId64],
    );
    await connection.query("COMMIT");
    return { conflict: false, user: { id: inserted.rows[0].id, name: inserted.rows[0].display_name } };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});

    if (error.code === "23505") {
      const concurrent = await pool.query(
        "SELECT id, google_sub, steam_id64, display_name FROM site6_users WHERE google_sub = $1 OR steam_id64 = $2",
        [googleIdentity.sub, steamId64],
      );
      const sameUser = concurrent.rows.length === 1 &&
        concurrent.rows[0].google_sub === googleIdentity.sub &&
        concurrent.rows[0].steam_id64 === steamId64;

      if (sameUser) {
        return { conflict: false, user: { id: concurrent.rows[0].id, name: concurrent.rows[0].display_name } };
      }
      return { conflict: true };
    }

    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { initializeDatabase, findUserById, registerOrAuthenticate };