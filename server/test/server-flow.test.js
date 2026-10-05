"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const session = require("express-session");
const { createApp } = require("../src/index");
const { createMemoryPool } = require("../test-utils/memory-pool");

function createConfig() {
  const frontendUrl = new URL("http://localhost:8000/");
  return {
    production: false,
    publicUrl: "https://auth.example",
    frontendUrl,
    frontendOrigins: new Set([frontendUrl.origin]),
    googleClientId: "public-client-id",
    googleClientSecret: "test-only-secret-not-a-real-credential",
    sessionSecret: "test-only-session-secret-longer-than-32-characters",
    sessionCookieName: "site6.test.sid",
    sessionTtlMs: 8 * 60 * 60 * 1000,
    pendingTtlMs: 10 * 60 * 1000,
    port: 0,
  };
}

function readCookie(response) {
  const value = response.headers.getSetCookie().at(0);
  assert.ok(value, "OAuth must persist its anti-forgery state in a server session");
  return value.split(";", 1)[0];
}

test("requires Google and Steam, persists a linked account, protects the session, and supports secure logout", async (context) => {
  const pool = createMemoryPool();
  let authOptions;
  const googleClient = {
    async generateCodeVerifierAsync() {
      return { codeVerifier: "test-pkce-verifier", codeChallenge: "test-pkce-challenge" };
    },
    generateAuthUrl(options) {
      authOptions = options;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      for (const [key, value] of Object.entries(options)) {
        url.searchParams.set(key, Array.isArray(value) ? value.join(" ") : value);
      }
      return url.href;
    },
    async getToken(options) {
      assert.equal(options.codeVerifier, "test-pkce-verifier");
      return { tokens: { id_token: "mock-verified-id-token" } };
    },
    async verifyIdToken() {
      return { getPayload: () => ({
        sub: "google-sub-verified-in-test",
        email: "verified@example.com",
        email_verified: true,
        name: "Вход подтверждён",
        nonce: authOptions.nonce,
      }) };
    },
  };
  let expectedSteamReturnTo;
  const app = createApp({
    config: createConfig(),
    pool,
    googleClient,
    sessionStore: new session.MemoryStore(),
    steamVerifier: async (_params, options) => {
      assert.equal(options.expectedReturnTo, expectedSteamReturnTo);
      return "76561198012345678";
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const frontendOrigin = "http://localhost:8000";

  const denied = await fetch(`${origin}/auth/session`, { headers: { Origin: "https://not-your-site.example" } });
  assert.equal(denied.status, 403);

  const preflight = await fetch(`${origin}/auth/logout`, {
    method: "OPTIONS",
    headers: { Origin: frontendOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-CSRF-Token" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), frontendOrigin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");

  assert.equal((await fetch(`${origin}/health`)).status, 200);
  const steamFirst = await fetch(`${origin}/auth/steam`, { redirect: "manual" });
  assert.equal(steamFirst.status, 303);
  assert.match(steamFirst.headers.get("location"), /google_required_first/);

  const startGoogle = await fetch(`${origin}/auth/google`, { redirect: "manual" });
  assert.equal(startGoogle.status, 303);
  const googleUrl = new URL(startGoogle.headers.get("location"));
  assert.equal(googleUrl.searchParams.get("code_challenge"), "test-pkce-challenge");
  assert.equal(googleUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(googleUrl.searchParams.get("redirect_uri"), "https://auth.example/auth/google/callback");
  let cookie = readCookie(startGoogle);

  const googleCallback = await fetch(
    `${origin}/auth/google/callback?state=${encodeURIComponent(googleUrl.searchParams.get("state"))}&code=one-time-code`,
    { headers: { Cookie: cookie }, redirect: "manual" },
  );
  assert.equal(googleCallback.status, 303);
  assert.match(googleCallback.headers.get("location"), /auth=google_verified/);
  cookie = readCookie(googleCallback);

  const googleSession = await fetch(`${origin}/auth/session`, { headers: { Cookie: cookie, Origin: frontendOrigin } });
  assert.deepEqual(await googleSession.json(), { authenticated: false, google: true, steam: false });

  const startSteam = await fetch(`${origin}/auth/steam`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(startSteam.status, 303);
  const steamUrl = new URL(startSteam.headers.get("location"));
  assert.equal(steamUrl.hostname, "steamcommunity.com");
  const returnTo = steamUrl.searchParams.get("openid.return_to");
  expectedSteamReturnTo = returnTo;
  const returnUrl = new URL(returnTo);
  const steamCallback = new URLSearchParams(returnUrl.search);
  const claimedId = "https://steamcommunity.com/openid/id/76561198012345678";
  for (const [key, value] of Object.entries({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": claimedId,
    "openid.identity": claimedId,
    "openid.return_to": returnTo,
    "openid.response_nonce": "test-steam-nonce",
    "openid.assoc_handle": "test-association",
    "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce",
    "openid.sig": "test-signature",
  })) steamCallback.set(key, value);

  const finishSteam = await fetch(`${origin}${returnUrl.pathname}?${steamCallback}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.equal(finishSteam.status, 303);
  assert.match(finishSteam.headers.get("location"), /auth=complete/);
  assert.equal(pool.users.length, 1);
  cookie = readCookie(finishSteam);

  const accountResponse = await fetch(`${origin}/auth/session`, { headers: { Cookie: cookie, Origin: frontendOrigin } });
  const account = await accountResponse.json();
  assert.equal(accountResponse.status, 200);
  assert.equal(account.authenticated, true);
  assert.equal(account.google, true);
  assert.equal(account.steam, true);
  assert.equal(account.user.name, "Вход подтверждён");
  assert.ok(account.csrf);

  const loggedOut = await fetch(`${origin}/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: frontendOrigin, "X-CSRF-Token": account.csrf },
  });
  assert.equal(loggedOut.status, 204);
  assert.equal(pool.users.length, 1);
});