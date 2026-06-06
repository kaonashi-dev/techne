import { describe, expect, test } from "bun:test";
import { parseArgv } from "../src/console/argv-parser";

describe("parseArgv", () => {
  test("--k=v form", () => {
    expect(parseArgv(["--limit=100"])).toEqual({ positionals: [], options: { limit: "100" } });
  });

  test("--k v form", () => {
    expect(parseArgv(["--limit", "100"])).toEqual({ positionals: [], options: { limit: "100" } });
  });

  test("-k v form", () => {
    expect(parseArgv(["-n", "bob"])).toEqual({ positionals: [], options: { n: "bob" } });
  });

  test("--flag boolean", () => {
    expect(parseArgv(["--pretty"])).toEqual({ positionals: [], options: { pretty: true } });
  });

  test("--no-flag sets false", () => {
    expect(parseArgv(["--no-color"])).toEqual({ positionals: [], options: { color: false } });
  });

  test("repeated key becomes array", () => {
    expect(parseArgv(["--tag", "a", "--tag", "b"])).toEqual({
      positionals: [],
      options: { tag: ["a", "b"] },
    });
  });

  test("-- terminates option parsing", () => {
    expect(parseArgv(["--pretty", "--", "--not-a-flag"])).toEqual({
      positionals: ["--not-a-flag"],
      options: { pretty: true },
    });
  });

  test("mixed positionals and options", () => {
    expect(parseArgv(["csv", "--limit=100", "--pretty"])).toEqual({
      positionals: ["csv"],
      options: { limit: "100", pretty: true },
    });
  });

  test("-k with no following value takes boolean", () => {
    expect(parseArgv(["-v"])).toEqual({ positionals: [], options: { v: true } });
  });

  test("positionals only", () => {
    expect(parseArgv(["a", "b", "c"])).toEqual({
      positionals: ["a", "b", "c"],
      options: {},
    });
  });
});
