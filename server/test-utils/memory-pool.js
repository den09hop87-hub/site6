"use strict";

function createMemoryPool() {
  const users = [];
  let schemaReady = false;

  async function query(sql, params = []) {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql.trim())) return { rows: [] };
    if (sql.includes("SELECT 1")) return { rows: [{ ok: 1 }] };
    if (sql.includes("CREATE TABLE IF NOT EXISTS site6_users")) {
      schemaReady = true;
      return { rows: [] };
    }
    if (sql.includes("SELECT id, display_name FROM site6_users")) {
      return { rows: users.filter((user) => user.id === params[0]).map((user) => ({ id: user.id, display_name: user.display_name })) };
    }
    if (sql.includes("WHERE google_sub = $1 OR steam_id64 = $2")) {
      return { rows: users.filter((user) => user.google_sub === params[0] || user.steam_id64 === params[1]) };
    }
    if (sql.includes("INSERT INTO site6_users")) {
      if (users.some((user) => user.google_sub === params[1] || user.steam_id64 === params[4])) {
        const error = new Error("Unique constraint violation");
        error.code = "23505";
        throw error;
      }
      const user = { id: params[0], google_sub: params[1], email: params[2], display_name: params[3], steam_id64: params[4] };
      users.push(user);
      return { rows: [{ id: user.id, display_name: user.display_name }] };
    }
    throw new Error(`Unexpected database query: ${sql}`);
  }

  return {
    users,
    get schemaReady() { return schemaReady; },
    query,
    async connect() { return { query, release() {} }; },
  };
}

module.exports = { createMemoryPool };