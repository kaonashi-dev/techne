import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { JwtService } from "../src/jwt";

const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");

/** Forge a token with an arbitrary header but a VALID HS256 HMAC over it. */
function forgeWithValidHmac(secret: string, header: object, payload: object): string {
  const h = b64url(header);
  const p = b64url(payload);
  const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

describe("JwtService (unit)", () => {
  test("signAsync/verifyAsync round-trips a payload", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    const token = await jwt.signAsync({ sub: "user-1" });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
    const payload = await jwt.verifyAsync<{ sub: string; iat: number }>(token);
    expect(payload.sub).toBe("user-1");
    expect(typeof payload.iat).toBe("number");
  });

  test("tampered token fails verification", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    const token = await jwt.signAsync({ sub: "user-1" });
    const [h, p] = token.split(".");
    // swap signature for a clearly invalid one of the same shape
    const tampered = `${h}.${p}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await expect(jwt.verifyAsync(tampered)).rejects.toThrow();
  });

  test("malformed token throws Invalid JWT", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    await expect(jwt.verifyAsync("not-a-jwt")).rejects.toThrow(/Invalid JWT/);
  });

  test("expiresIn produces an exp claim", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    const before = Math.floor(Date.now() / 1000);
    const token = await jwt.signAsync({ sub: "user-1" }, { expiresIn: "1h" });
    const payload = await jwt.verifyAsync<{ exp: number; iat: number }>(token);
    expect(typeof payload.exp).toBe("number");
    // exp should be roughly 3600s ahead of iat
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload.exp).toBeGreaterThanOrEqual(before + 3600);
  });

  test("expiresIn accepts numeric seconds", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    const token = await jwt.signAsync({ sub: "user-1" }, { expiresIn: 120 });
    const payload = await jwt.verifyAsync<{ exp: number; iat: number }>(token);
    expect(payload.exp - payload.iat).toBe(120);
  });

  test("verification with wrong secret fails", async () => {
    const signer = new JwtService({ secret: "secret-A" });
    const verifier = new JwtService({ secret: "secret-B" });
    const token = await signer.signAsync({ sub: "user-1" });
    await expect(verifier.verifyAsync(token)).rejects.toThrow(/Invalid JWT signature/);
  });

  test("default signOptions.expiresIn is applied when no override given", async () => {
    const jwt = new JwtService({
      secret: "test-secret",
      signOptions: { expiresIn: "1h" },
    });
    const token = await jwt.signAsync({ sub: "user-1" });
    const payload = await jwt.verifyAsync<{ exp: number; iat: number }>(token);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  test("rejects a non-HS256 header alg even with a valid HMAC (alg-pin)", async () => {
    // The service always computes an HS256 HMAC, so this forged token has a
    // signature that would otherwise pass — the explicit alg pin must reject it.
    const jwt = new JwtService({ secret: "test-secret" });
    const token = forgeWithValidHmac(
      "test-secret",
      { alg: "HS512", typ: "JWT" },
      { sub: "attacker" },
    );
    await expect(jwt.verifyAsync(token)).rejects.toThrow(/algorithm/i);
  });

  test("rejects alg:none tokens", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    // Classic alg:none with an empty signature segment.
    const h = b64url({ alg: "none", typ: "JWT" });
    const p = b64url({ sub: "attacker" });
    await expect(jwt.verifyAsync(`${h}.${p}.`)).rejects.toThrow(/Invalid JWT/);
    // Even a forged HMAC can't smuggle alg:none past the pin.
    const forged = forgeWithValidHmac("test-secret", { alg: "none", typ: "JWT" }, { sub: "x" });
    await expect(jwt.verifyAsync(forged)).rejects.toThrow(/algorithm/i);
  });

  test("issuer/audience claims are enforced on verify", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    const token = await jwt.signAsync({ sub: "user-1" }, { issuer: "iss-1", audience: "aud-1" });
    const ok = await jwt.verifyAsync<{ iss: string; aud: string }>(token, {
      issuer: "iss-1",
      audience: "aud-1",
    });
    expect(ok.iss).toBe("iss-1");
    expect(ok.aud).toBe("aud-1");
    await expect(jwt.verifyAsync(token, { issuer: "other" })).rejects.toThrow(/issuer/);
    await expect(jwt.verifyAsync(token, { audience: "other" })).rejects.toThrow(/audience/);
  });
});
