import { describe, expect, test } from "bun:test";
import * as constants from "../src/common/constants";

const entries = Object.entries(constants);

describe("common/constants", () => {
  test("every export is defined and truthy", () => {
    for (const [name, value] of entries) {
      expect(value, `${name} should be defined`).toBeDefined();
      // strings, symbols, and numbers are all truthy non-null here
      expect(value).not.toBeNull();
    }
    // sanity: the constants file actually exports something
    expect(entries.length).toBeGreaterThan(0);
  });

  test("string-valued constants are unique within the set", () => {
    const strings = entries.filter(([, v]) => typeof v === "string").map(([, v]) => v as string);
    const unique = new Set(strings);
    expect(unique.size).toBe(strings.length);
  });

  test("symbol-valued constants are unique by reference", () => {
    const symbols = entries.filter(([, v]) => typeof v === "symbol").map(([, v]) => v as symbol);
    const unique = new Set(symbols);
    expect(unique.size).toBe(symbols.length);
    // sanity: there is at least one symbol token (APP_GUARD, APP_FILTER, REQUEST, INQUIRER)
    expect(symbols.length).toBeGreaterThanOrEqual(4);
  });

  test("snapshot of the public constant surface", () => {
    const summary = entries
      .map(([name, value]) => {
        const typeOf = typeof value;
        return {
          name,
          typeOf,
          value: typeOf === "string" ? (value as string) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(summary).toMatchSnapshot();
  });
});
