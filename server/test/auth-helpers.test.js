"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  constantTimeEqual,
  createRandomToken,
  parseSteamAccountId,
  verifySteamOpenId,
} = require("../src/auth-helpers");

function validSteamResponse() {
  return new URLSearchParams({
    state: "secure-state",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198012345678",
    "openid.identity": "https://steamcommunity.com/openid/id/76561198012345678",
    "openid.return_to": "https://auth.example/auth/steam/callback?state=secure-state",
    "openid.response_nonce": "2026-10-04T12:00:00Zunique-nonce",
    "openid.assoc_handle": "steam-handle",
    "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce",
    "openid.sig": "provider-signature",
  });
}

test("creates cryptographically random URL-safe flow tokens", () => {
  const first = createRandomToken();
  const second = createRandomToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("compares OAuth state without accepting empty or different values", () => {
  assert.equal(constantTimeEqual("secure-state", "secure-state"), true);
  assert.equal(constantTimeEqual("secure-state", "other-state"), false);
  assert.equal(constantTimeEqual("", ""), false);
  assert.equal(constantTimeEqual("secure-state", undefined), false);
});

test("accepts a canonical 17-digit Steam ID only when both OpenID claims match", () => {
  const valid = "https://steamcommunity.com/openid/id/76561198012345678";
  assert.equal(parseSteamAccountId(valid, valid), "76561198012345678");
  assert.equal(parseSteamAccountId(valid, "https://steamcommunity.com/openid/id/76561198012345679"), null);
  assert.equal(parseSteamAccountId(valid.replace("https:", "http:"), valid.replace("https:", "http:")), null);
  assert.equal(parseSteamAccountId("https://evil.example/openid/id/76561198012345678", "https://evil.example/openid/id/76561198012345678"), null);
});

test("verifies Steam OpenID claims with Steam before accepting an account", async () => {
  const params = validSteamResponse();
  let sentVerification;
  const steamId = await verifySteamOpenId(params, {
    expectedState: "secure-state",
    expectedReturnTo: "https://auth.example/auth/steam/callback?state=secure-state",
    expectedRealm: "https://auth.example/",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://steamcommunity.com/openid/login");
      sentVerification = new URLSearchParams(options.body);
      return { ok: true, text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n" };
    },
  });

  assert.equal(steamId, "76561198012345678");
  assert.equal(sentVerification.get("openid.mode"), "check_authentication");
  assert.equal(sentVerification.get("openid.claimed_id"), params.get("openid.claimed_id"));
  assert.equal(sentVerification.has("state"), false);
});

test("rejects changed state, OpenID fields, unsigned claims, and unverified Steam responses", async () => {
  const options = {
    expectedState: "secure-state",
    expectedReturnTo: "https://auth.example/auth/steam/callback?state=secure-state",
    expectedRealm: "https://auth.example/",
    fetchImpl: async () => ({ ok: true, text: async () => "is_valid:true\n" }),
  };
  const changedState = validSteamResponse();
  changedState.set("state", "attacker-state");
  await assert.rejects(verifySteamOpenId(changedState, options), { message: "invalid_oauth_state" });

  const forgedIdentity = validSteamResponse();
  forgedIdentity.set("openid.identity", "https://steamcommunity.com/openid/id/76561198012345679");
  await assert.rejects(verifySteamOpenId(forgedIdentity, options), { message: "invalid_steam_identity" });

  const unsigned = validSteamResponse();
  unsigned.set("openid.signed", "op_endpoint,identity,return_to,response_nonce");
  await assert.rejects(verifySteamOpenId(unsigned, options), { message: "unsigned_steam_identity" });

  const noProof = validSteamResponse();
  await assert.rejects(verifySteamOpenId(noProof, { ...options, fetchImpl: async () => ({ ok: true, text: async () => "is_valid:false\n" }) }), { message: "steam_signature_invalid" });

});