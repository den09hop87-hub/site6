"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { initializeDatabase, registerOrAuthenticate } = require("../src/database");
const { createMemoryPool } = require("../test-utils/memory-pool");

test("creates the user database table during setup", async () => {
  const pool = createMemoryPool();
  await initializeDatabase(pool);
  assert.equal(pool.schemaReady, true);
});

test("automatically registers and recognises the same verified Google and Steam account pair", async () => {
  const pool = createMemoryPool();
  await initializeDatabase(pool);
  const google = { sub: "google-user-1", email: "user@example.com", name: "Персонал" };
  const steamId = "76561198012345678";

  const created = await registerOrAuthenticate(pool, google, steamId);
  assert.equal(created.conflict, false);
  assert.equal(created.user.name, "Персонал");
  assert.equal(pool.users.length, 1);

  assert.deepEqual(await registerOrAuthenticate(pool, google, steamId), created);
  assert.equal(pool.users.length, 1);
});

test("refuses silently relinking either existing provider account to someone else", async () => {
  const pool = createMemoryPool();
  await initializeDatabase(pool);
  const google = { sub: "google-user-1", email: "one@example.com", name: "Первый" };
  const steamId = "76561198012345678";
  await registerOrAuthenticate(pool, google, steamId);

  assert.deepEqual(await registerOrAuthenticate(
    pool,
    { sub: "google-user-2", email: "two@example.com", name: "Второй" },
    steamId,
  ), { conflict: true });
  assert.deepEqual(await registerOrAuthenticate(pool, google, "76561198012345679"), { conflict: true });
  assert.equal(pool.users.length, 1);
});
