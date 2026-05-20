import { describe, expect, test } from "bun:test";
import { JwtService } from "../src/jwt";

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

  test("issuer/audience claims are enforced on verify", async () => {
    const jwt = new JwtService({ secret: "test-secret" });
    const token = await jwt.signAsync(
      { sub: "user-1" },
      { issuer: "iss-1", audience: "aud-1" },
    );
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
