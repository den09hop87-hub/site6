"use strict";

function loadConfig(env = process.env) {
  const required = ["PUBLIC_URL", "FRONTEND_URL", "DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  if (env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");

  const production = env.NODE_ENV === "production";
  const publicUrl = new URL(env.PUBLIC_URL);
  const frontendUrl = new URL(env.FRONTEND_URL);
  if (production && (publicUrl.protocol !== "https:" || frontendUrl.protocol !== "https:")) {
    throw new Error("PUBLIC_URL and FRONTEND_URL must use HTTPS in production.");
  }

  const origins = new Set([
    frontendUrl.origin,
    ...(env.FRONTEND_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
  ]);
  for (const origin of origins) {
    if (new URL(origin).origin !== origin) throw new Error(`Invalid FRONTEND_ORIGINS entry: ${origin}`);
  }

  return {
    production,
    publicUrl: publicUrl.origin,
    frontendUrl,
    frontendOrigins: origins,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL === "true",
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    sessionCookieName: env.SESSION_COOKIE_NAME || (production ? "__Host-site6.sid" : "site6.sid"),
    sessionTtlMs: 8 * 60 * 60 * 1000,
    pendingTtlMs: 10 * 60 * 1000,
    port: Number(env.PORT || 3000),
  };
}

module.exports = { loadConfig };