"use strict";

const crypto = require("node:crypto");

const STEAM_OPENID_NAMESPACE = "http://specs.openid.net/auth/2.0";
const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";

function createRandomToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length === 0 || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function parseSteamAccountId(claimedId, identity) {
  if (typeof claimedId !== "string" || claimedId !== identity) return null;
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimedId);
  return match?.[1] ?? null;
}

async function verifySteamOpenId(params, { expectedState, expectedReturnTo, fetchImpl = fetch }) {
  if (!(params instanceof URLSearchParams)) throw new Error("invalid_steam_response");
  if (!constantTimeEqual(params.get("state"), expectedState)) throw new Error("invalid_oauth_state");
  if (params.get("openid.ns") !== STEAM_OPENID_NAMESPACE) throw new Error("invalid_steam_namespace");
  if (params.get("openid.mode") !== "id_res") throw new Error("invalid_steam_mode");
  if (params.get("openid.return_to") !== expectedReturnTo) throw new Error("invalid_steam_return_to");
  if (!parseSteamAccountId(params.get("openid.claimed_id"), params.get("openid.identity"))) {
    throw new Error("invalid_steam_identity");
  }

  const endpoint = new URL(params.get("openid.op_endpoint") || "");
  if (endpoint.href !== STEAM_OPENID_ENDPOINT) throw new Error("invalid_steam_endpoint");
  const signedFields = new Set((params.get("openid.signed") || "").split(","));
  for (const field of ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce"]) {
    if (!signedFields.has(field)) throw new Error("unsigned_steam_identity");
  }

  const verification = new URLSearchParams();
  for (const [key, value] of params) {
    if (key.startsWith("openid.")) verification.append(key, value);
  }
  verification.set("openid.mode", "check_authentication");

  const response = await fetchImpl(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: verification,
  });
  if (!response.ok) throw new Error("steam_verification_unavailable");
  if (!/^is_valid:true\s*$/m.test(await response.text())) throw new Error("steam_signature_invalid");

  return parseSteamAccountId(params.get("openid.claimed_id"), params.get("openid.identity"));
}

module.exports = { createRandomToken, constantTimeEqual, parseSteamAccountId, verifySteamOpenId };