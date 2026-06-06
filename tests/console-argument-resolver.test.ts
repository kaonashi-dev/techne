import "../src/reflect-setup";
import { describe, expect, test } from "bun:test";
import { resolveArguments } from "../src/console/argument-resolver";
import { parseArgv } from "../src/console/argv-parser";
import { ConsoleArgumentError } from "../src/console/errors";

describe("resolveArguments", () => {
  test("maps positionals and coerces numbers", () => {
    const params: any[] = [
      { index: 0, kind: "argument", name: "format", required: true, metatype: String },
      { index: 1, kind: "option", name: "limit", metatype: Number, default: 10 },
    ];
    expect(resolveArguments(params, parseArgv(["csv", "--limit=100"]))).toEqual(["csv", 100]);
  });

  test("uses default for missing option", () => {
    const params: any[] = [
      { index: 0, kind: "option", name: "limit", metatype: Number, default: 50 },
    ];
    expect(resolveArguments(params, parseArgv([]))).toEqual([50]);
  });

  test("boolean option defaults false when missing", () => {
    const params: any[] = [{ index: 0, kind: "option", name: "pretty", metatype: Boolean }];
    expect(resolveArguments(params, parseArgv([]))).toEqual([false]);
  });

  test("boolean option coerces string 'true'", () => {
    const params: any[] = [{ index: 0, kind: "option", name: "pretty", metatype: Boolean }];
    expect(resolveArguments(params, parseArgv(["--pretty", "true"]))).toEqual([true]);
  });

  test("boolean flag coerces true", () => {
    const params: any[] = [{ index: 0, kind: "option", name: "pretty", metatype: Boolean }];
    expect(resolveArguments(params, parseArgv(["--pretty"]))).toEqual([true]);
  });

  test("option alias lookup", () => {
    const params: any[] = [
      { index: 0, kind: "option", name: "limit", metatype: Number, aliases: ["l"], default: 10 },
    ];
    expect(resolveArguments(params, parseArgv(["-l", "5"]))).toEqual([5]);
  });

  test("throws on missing required argument", () => {
    const params: any[] = [
      { index: 0, kind: "argument", name: "format", required: true, metatype: String },
    ];
    expect(() => resolveArguments(params, parseArgv([]))).toThrow(ConsoleArgumentError);
    expect(() => resolveArguments(params, parseArgv([]))).toThrow(/Missing required argument/);
  });

  test("throws on missing required option", () => {
    const params: any[] = [
      { index: 0, kind: "option", name: "token", required: true, metatype: String },
    ];
    expect(() => resolveArguments(params, parseArgv([]))).toThrow(/Missing required option/);
  });

  test("throws on bad number", () => {
    const params: any[] = [
      { index: 0, kind: "argument", name: "count", required: true, metatype: Number },
    ];
    expect(() => resolveArguments(params, parseArgv(["abc"]))).toThrow(/must be a number/);
  });

  test("enum validation accepts valid value", () => {
    const MyEnum = { CSV: "csv", JSON: "json" };
    const params: any[] = [
      { index: 0, kind: "argument", name: "fmt", required: true, enum: MyEnum },
    ];
    expect(resolveArguments(params, parseArgv(["csv"]))).toEqual(["csv"]);
  });

  test("enum validation rejects invalid value", () => {
    const MyEnum = { CSV: "csv", JSON: "json" };
    const params: any[] = [
      { index: 0, kind: "argument", name: "fmt", required: true, enum: MyEnum },
    ];
    expect(() => resolveArguments(params, parseArgv(["xml"]))).toThrow(/Invalid value/);
  });

  test("preserves positional order across multiple arguments", () => {
    const params: any[] = [
      { index: 1, kind: "argument", name: "dest", required: true, metatype: String },
      { index: 0, kind: "argument", name: "src", required: true, metatype: String },
    ];
    expect(resolveArguments(params, parseArgv(["a", "b"]))).toEqual(["a", "b"]);
  });
});
