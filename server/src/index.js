"use strict";

require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const { OAuth2Client } = require("google-auth-library");
const { Pool } = require("pg");
const { constantTimeEqual, createRandomToken, verifySteamOpenId } = require("./auth-helpers");
const { loadConfig } = require("./config");
const { findUserById, initializeDatabase, registerOrAuthenticate } = require("./database");

const GOOGLE_SCOPES = ["openid", "email", "profile"];
const SESSION_STORE_TABLE = "site6_auth_sessions";

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function frontendCallback(config, result, code) {
  const destination = new URL(config.frontendUrl);
  destination.searchParams.set("auth", result);
  if (code) destination.searchParams.set("code", code);
  return destination.href;
}

function failAuthentication(response, config, code) {
  return response.redirect(303, frontendCallback(config, "error", code));
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function createApp({ config = loadConfig(), pool, googleClient, steamVerifier = verifySteamOpenId, sessionStore } = {}) {
  if (!pool) throw new Error("A PostgreSQL connection pool is required.");

  const app = express();
  const PgSession = connectPgSimple(session);
  const authClient = googleClient || new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    `${config.publicUrl}/auth/google/callback`,
  );

  app.disable("x-powered-by");
  if (config.production) app.set("trust proxy", 1);

  app.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Vary", "Origin");
    if (config.production) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

    const origin = request.get("origin");
    if (origin) {
      if (!config.frontendOrigins.has(origin)) {
        response.status(403).json({ error: "origin_not_allowed" });
        return;
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    }

    if (request.method === "OPTIONS") {
      if (!origin) return response.sendStatus(403);
      return response.sendStatus(204);
    }
    next();
  });

  app.use(session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    store: sessionStore || new PgSession({ pool, tableName: SESSION_STORE_TABLE, createTableIfMissing: true }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.production,
      sameSite: config.production ? "none" : "lax",
      path: "/",
      maxAge: config.sessionTtlMs,
    },
  }));

  const authenticationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_attempts" },
  });
  const googleRedirectUrl = `${config.publicUrl}/auth/google/callback`;
  const steamEndpoint = new URL("https://steamcommunity.com/openid/login");

  app.get("/health", asyncRoute(async (_request, response) => {
    await pool.query("SELECT 1");
    response.json({ ok: true });
  }));

  app.get("/auth/google", authenticationLimiter, asyncRoute(async (request, response) => {
    const state = createRandomToken();
    const nonce = createRandomToken();
    const { codeVerifier, codeChallenge } = await authClient.generateCodeVerifierAsync();
    request.session.googleOAuth = { state, nonce, codeVerifier, expiresAt: Date.now() + config.pendingTtlMs };
    request.session.cookie.maxAge = config.pendingTtlMs;
    await saveSession(request);

    const url = authClient.generateAuthUrl({
      redirect_uri: googleRedirectUrl,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "online",
      prompt: "select_account",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    response.redirect(303, url);
  }));

  app.get("/auth/google/callback", authenticationLimiter, asyncRoute(async (request, response) => {
    const pending = request.session.googleOAuth;
    delete request.session.googleOAuth;

    if (request.query.error) {
      await saveSession(request);
      return failAuthentication(response, config, "google_cancelled");
    }
    if (!pending || Date.now() > pending.expiresAt || !constantTimeEqual(request.query.state, pending.state) || typeof request.query.code !== "string") {
      await saveSession(request);
      return failAuthentication(response, config, "invalid_google_state");
    }

    let identity;
    try {
      const { tokens } = await authClient.getToken({ code: request.query.code, codeVerifier: pending.codeVerifier });
      if (!tokens.id_token) throw new Error("missing_google_id_token");
      const ticket = await authClient.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
      const claims = ticket.getPayload();

      if (!claims || !claims.sub || claims.email_verified !== true || !constantTimeEqual(claims.nonce, pending.nonce)) {
        throw new Error("unverified_google_account");
      }
      identity = {
        sub: claims.sub,
        email: claims.email,
        name: claims.name || claims.email?.split("@")[0] || "Пользователь",
      };
    } catch (error) {
      console.error("Google sign-in verification failed:", error.message);
      await saveSession(request);
      return failAuthentication(response, config, "google_verification_failed");
    }

    request.session.googleIdentity = identity;
    request.session.cookie.maxAge = config.pendingTtlMs;
    await saveSession(request);
    response.redirect(303, frontendCallback(config, "google_verified"));
  }));

  app.get("/auth/steam", authenticationLimiter, asyncRoute(async (request, response) => {
    if (!request.session.googleIdentity) {
      return failAuthentication(response, config, "google_required_first");
    }

    const state = createRandomToken();
    const returnTo = new URL(`/auth/steam/callback?state=${encodeURIComponent(state)}`, config.publicUrl).href;
    const realm = `${config.publicUrl}/`;
    request.session.steamOAuth = { state, returnTo, realm, expiresAt: Date.now() + config.pendingTtlMs };
    request.session.cookie.maxAge = config.pendingTtlMs;
    await saveSession(request);

    steamEndpoint.search = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": returnTo,
      "openid.realm": realm,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }).toString();
    response.redirect(303, steamEndpoint.href);
  }));

  app.get("/auth/steam/callback", authenticationLimiter, asyncRoute(async (request, response) => {
    const pending = request.session.steamOAuth;
    delete request.session.steamOAuth;
    if (!request.session.googleIdentity) {
      await saveSession(request);
      return failAuthentication(response, config, "google_required_first");
    }
    if (!pending || Date.now() > pending.expiresAt) {
      await saveSession(request);
      return failAuthentication(response, config, "steam_state_expired");
    }

    let steamId64;
    try {
      const params = new URL(request.originalUrl, config.publicUrl).searchParams;
      steamId64 = await steamVerifier(params, {
        expectedState: pending.state,
        expectedReturnTo: pending.returnTo,
      });
    } catch (error) {
      console.error("Steam OpenID verification failed:", error.message);
      await saveSession(request);
      return failAuthentication(response, config, "steam_verification_failed");
    }

    const registration = await registerOrAuthenticate(pool, request.session.googleIdentity, steamId64);
    if (registration.conflict) {
      delete request.session.googleIdentity;
      await saveSession(request);
      return failAuthentication(response, config, "accounts_already_linked");
    }

    await regenerateSession(request);
    request.session.userId = registration.user.id;
    request.session.csrfToken = createRandomToken();
    request.session.cookie.maxAge = config.sessionTtlMs;
    await saveSession(request);
    response.redirect(303, frontendCallback(config, "complete"));
  }));

  app.get("/auth/session", asyncRoute(async (request, response) => {
    const google = Boolean(request.session.googleIdentity);
    if (!request.session.userId) {
      return response.json({ authenticated: false, google, steam: false });
    }

    const user = await findUserById(pool, request.session.userId);
    if (!user) {
      return response.json({ authenticated: false, google: false, steam: false });
    }
    if (!request.session.csrfToken) request.session.csrfToken = createRandomToken();
    await saveSession(request);
    response.json({
      authenticated: true,
      google: true,
      steam: true,
      csrf: request.session.csrfToken,
      user: { name: user.display_name },
    });
  }));

  app.post("/auth/logout", asyncRoute(async (request, response) => {
    const origin = request.get("origin");
    if (!origin || !config.frontendOrigins.has(origin)) return response.sendStatus(403);
    if (!constantTimeEqual(request.get("x-csrf-token"), request.session.csrfToken)) {
      return response.status(403).json({ error: "invalid_csrf_token" });
    }

    request.session.destroy((error) => {
      if (error) return response.status(500).json({ error: "logout_failed" });
      response.clearCookie(config.sessionCookieName, {
        httpOnly: true,
        secure: config.production,
        sameSite: config.production ? "none" : "lax",
        path: "/",
      });
      response.sendStatus(204);
    });
  }));

  app.use((_request, response) => response.status(404).json({ error: "not_found" }));
  app.use((error, _request, response, _next) => {
    console.error("Authentication service error:", error.message);
    if (response.headersSent) return;
    response.status(500).json({ error: "authentication_service_error" });
  });

  return app;
}

async function start() {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ...(config.databaseSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  await initializeDatabase(pool);
  const app = createApp({ config, pool });
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`Site6 authentication service listening on port ${config.port}`);
  });
  const stop = () => server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Authentication service failed to start:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApp, start };