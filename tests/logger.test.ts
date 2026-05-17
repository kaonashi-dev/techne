import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  Logger,
  BufferSink,
  NullSink,
  requestContext,
  LEVEL_ORDER,
  stringifySafe,
  type LogLevel,
} from "../src/services/logger.service";

// ── Helpers ────────────────────────────────────────────────────────────────

function withSink(sink: BufferSink, fn: () => void) {
  const prevSink = Logger.getSink();
  const prevMode = Logger.getMode();
  Logger.setSink(sink);
  // Ensure logging is active for the duration of the assertion — any prior
  // TechneFactory.create({ logger: false }) call may have set mode=false.
  if (prevMode === false) Logger.setMode("pretty");
  try {
    fn();
  } finally {
    Logger.setSink(prevSink);
    Logger.setMode(prevMode);
  }
}

function withMode(mode: ReturnType<typeof Logger.getMode>, fn: () => void) {
  const prev = Logger.getMode();
  Logger.setMode(mode);
  try {
    fn();
  } finally {
    Logger.setMode(prev);
  }
}

function withMinLevel(level: LogLevel, fn: () => void) {
  const prev = Logger.getMinLevel();
  Logger.setMinLevel(level);
  try {
    fn();
  } finally {
    Logger.setMinLevel(prev);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Logger", () => {
  describe("pretty mode", () => {
    test("log() emits [Techne] prefix", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").log("hello");
        });
      });
      expect(buf.lines.length).toBe(1);
      expect(buf.lines[0]).toContain("[Techne]");
    });

    test("log() includes context name", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("MyContext").log("hello");
        });
      });
      expect(buf.lines[0]).toContain("[MyContext]");
    });

    test("log() defaults context to Application", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger().log("hello");
        });
      });
      expect(buf.lines[0]).toContain("[Application]");
    });

    test("log() accepts override context as second arg", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Base").log("hello", "Override");
        });
      });
      expect(buf.lines[0]).toContain("[Override]");
    });

    test("log() includes meta as key=value suffix", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").log("msg", { userId: "u1", action: "click" });
        });
      });
      expect(buf.lines[0]).toContain("userId=u1");
      expect(buf.lines[0]).toContain("action=click");
    });

    test("warn() emits WRN level tag", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").warn("warning");
        });
      });
      expect(buf.lines[0]).toContain("WRN");
    });

    test("debug() emits DBG level tag", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").debug("debug msg");
        });
      });
      expect(buf.lines[0]).toContain("DBG");
    });

    test("verbose() emits VRB level tag", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").verbose("verbose msg");
        });
      });
      expect(buf.lines[0]).toContain("VRB");
    });

    test("error() emits ERR level tag", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").error("something failed");
        });
      });
      expect(buf.lines[0]).toContain("ERR");
    });

    test("error() with trace prints stack as separate line in pretty mode", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").error("oops", "Error: oops\n  at foo", "Ctx");
        });
      });
      expect(buf.lines.length).toBe(2);
      expect(buf.lines[1]).toContain("at foo");
    });

    test("error() with Error instance uses message and stack", () => {
      const buf = new BufferSink();
      const err = new Error("boom");
      withSink(buf, () => {
        withMode("pretty", () => {
          new Logger("Test").error(err);
        });
      });
      expect(buf.lines[0]).toContain("boom");
    });

    test("child() propagates requestId in [req=...] tag", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          const parent = new Logger("Test");
          const child = parent.child("req-123");
          child.log("with id");
        });
      });
      expect(buf.lines[0]).toContain("[req=req-123]");
    });
  });

  describe("JSON mode", () => {
    test("log() emits valid JSON with name=Techne", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("Test").log("hello");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.name).toBe("Techne");
      expect(rec.msg).toBe("hello");
      expect(rec.level).toBe("log");
    });

    test("JSON record includes ctx field", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("SvcA").log("hi");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.ctx).toBe("SvcA");
    });

    test("JSON record includes requestId when set on instance", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("Test", "req-abc").log("hi");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.requestId).toBe("req-abc");
    });

    test("JSON record includes meta fields", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("Test").log("msg", { foo: "bar", n: 42 });
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.foo).toBe("bar");
      expect(rec.n).toBe(42);
    });

    test("error() with Error emits trace field in JSON", () => {
      const buf = new BufferSink();
      const err = new Error("boom");
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("Test").error(err);
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.msg).toBe("boom");
      expect(typeof rec.trace).toBe("string");
      expect(rec.trace).toContain("Error: boom");
    });

    test("error() legacy form emits trace in JSON record", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("Test").error("oops", "stack trace here");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.trace).toBe("stack trace here");
      // In JSON mode no extra line is emitted for the stack
      expect(buf.lines.length).toBe(1);
    });

    test("time field is a valid ISO string", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("Test").log("hi");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(() => new Date(rec.time)).not.toThrow();
      expect(new Date(rec.time).toISOString()).toBe(rec.time);
    });
  });

  describe("level filtering (L3)", () => {
    test("minLevel=error suppresses log/warn/debug/verbose", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          withMinLevel("error", () => {
            const l = new Logger("T");
            l.log("nope");
            l.warn("nope");
            l.debug("nope");
            l.verbose("nope");
          });
        });
      });
      expect(buf.lines.length).toBe(0);
    });

    test("minLevel=error allows error through", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          withMinLevel("error", () => {
            new Logger("T").error("yes");
          });
        });
      });
      expect(buf.lines.length).toBe(1);
      expect(JSON.parse(buf.lines[0]).msg).toBe("yes");
    });

    test("minLevel=warn allows error+warn, blocks log/debug/verbose", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          withMinLevel("warn", () => {
            const l = new Logger("T");
            l.error("e");
            l.warn("w");
            l.log("nope");
            l.debug("nope");
            l.verbose("nope");
          });
        });
      });
      expect(buf.lines.length).toBe(2);
    });

    test("LEVEL_ORDER constant is correct", () => {
      expect(LEVEL_ORDER.error).toBeLessThan(LEVEL_ORDER.warn);
      expect(LEVEL_ORDER.warn).toBeLessThan(LEVEL_ORDER.log);
      expect(LEVEL_ORDER.log).toBeLessThan(LEVEL_ORDER.debug);
      expect(LEVEL_ORDER.debug).toBeLessThan(LEVEL_ORDER.verbose);
    });
  });

  describe("safe serialization (L2)", () => {
    test("stringifySafe handles circular references", () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      const result = stringifySafe(obj);
      expect(result).toContain("[Circular]");
      expect(() => JSON.parse(result)).not.toThrow();
    });

    test("log() with circular object does not throw", () => {
      const obj: any = { name: "test" };
      obj.self = obj;
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          expect(() => new Logger("T").log(obj)).not.toThrow();
        });
      });
    });

    test("JSON mode serializes circular object safely", () => {
      const obj: any = { x: 1 };
      obj.ref = obj;
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          expect(() => new Logger("T").log(obj)).not.toThrow();
          expect(buf.lines.length).toBe(1);
        });
      });
    });
  });

  describe("redaction (L7)", () => {
    afterEach(() => {
      Logger.setRedact([]);
    });

    test("redacts top-level fields in JSON output", () => {
      Logger.setRedact(["password"]);
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("T").log("login", { user: "alice", password: "secret" });
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.password).toBe("[REDACTED]");
      expect(rec.user).toBe("alice");
    });

    test("redacts nested fields via dotted path", () => {
      Logger.setRedact(["auth.token"]);
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("T").log("req", { auth: { token: "secret123", scheme: "Bearer" } });
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.auth.token).toBe("[REDACTED]");
      expect(rec.auth.scheme).toBe("Bearer");
    });

    test("does not redact in pretty mode", () => {
      Logger.setRedact(["password"]);
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("pretty", () => {
          // Pretty mode does not run the redaction path
          new Logger("T").log("login", { password: "secret" });
        });
      });
      // Pretty mode doesn't apply structured redaction (it serializes inline)
      expect(buf.lines.length).toBe(1);
    });
  });

  describe("AsyncLocalStorage requestId propagation (L5)", () => {
    test("Logger reads requestId from ALS context", async () => {
      const buf = new BufferSink();
      await new Promise<void>((resolve) => {
        requestContext.run({ requestId: "als-req-1" }, () => {
          withSink(buf, () => {
            withMode("json", () => {
              new Logger("Test").log("inside als");
            });
          });
          resolve();
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.requestId).toBe("als-req-1");
    });

    test("instance requestId takes priority over ALS context", async () => {
      const buf = new BufferSink();
      await new Promise<void>((resolve) => {
        requestContext.run({ requestId: "als-req" }, () => {
          withSink(buf, () => {
            withMode("json", () => {
              new Logger("Test", "instance-req").log("msg");
            });
          });
          resolve();
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.requestId).toBe("instance-req");
    });

    test("Logger outside ALS context has no requestId", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("Test").log("no context");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.requestId).toBeUndefined();
    });

    test("ALS context includes traceId in JSON record (L12)", async () => {
      const buf = new BufferSink();
      const fakeTraceId = "a".repeat(32);
      await new Promise<void>((resolve) => {
        requestContext.run({ requestId: "r1", traceId: fakeTraceId }, () => {
          withSink(buf, () => {
            withMode("json", () => {
              new Logger("Test").log("traced");
            });
          });
          resolve();
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.traceId).toBe(fakeTraceId);
    });
  });

  describe("pluggable sinks (L6)", () => {
    test("NullSink discards all output", () => {
      const prev = Logger.getSink();
      Logger.setSink(new NullSink());
      withMode("json", () => {
        // Should not throw and should produce no output
        new Logger("T").log("silent");
        new Logger("T").error("silent error");
      });
      Logger.setSink(prev);
      // No assertion needed — the test passing without exception is the check
    });

    test("BufferSink collects records with level", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("T").log("a");
          new Logger("T").warn("b");
          new Logger("T").error("c");
        });
      });
      expect(buf.records.length).toBe(3);
      expect(buf.records[0].level).toBe("log");
      expect(buf.records[1].level).toBe("warn");
      expect(buf.records[2].level).toBe("error");
    });

    test("BufferSink.clear() resets state", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          new Logger("T").log("x");
          buf.clear();
          new Logger("T").log("y");
        });
      });
      expect(buf.lines.length).toBe(1);
      expect(JSON.parse(buf.lines[0]).msg).toBe("y");
    });

    test("getSink() returns the currently active sink", () => {
      const buf = new BufferSink();
      const prev = Logger.getSink();
      Logger.setSink(buf);
      expect(Logger.getSink()).toBe(buf);
      Logger.setSink(prev);
    });
  });

  describe("mode=false silences all output", () => {
    test("no lines emitted when mode is false", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode(false, () => {
          const l = new Logger("T");
          l.log("nope");
          l.warn("nope");
          l.error("nope");
          l.debug("nope");
          l.verbose("nope");
        });
      });
      expect(buf.lines.length).toBe(0);
    });
  });

  describe("child logger", () => {
    test("child inherits parent context", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          const parent = new Logger("Parent");
          const child = parent.child("req-xyz");
          child.log("from child");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.ctx).toBe("Parent");
      expect(rec.requestId).toBe("req-xyz");
    });

    test("child context override replaces parent context", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          const parent = new Logger("Parent");
          const child = parent.child("req-1", "ChildCtx");
          child.log("msg");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.ctx).toBe("ChildCtx");
      expect(rec.requestId).toBe("req-1");
    });
  });

  describe("setContext()", () => {
    test("setContext() updates the context for subsequent calls", () => {
      const buf = new BufferSink();
      withSink(buf, () => {
        withMode("json", () => {
          const l = new Logger("Old");
          l.setContext("New");
          l.log("hi");
        });
      });
      const rec = JSON.parse(buf.lines[0]);
      expect(rec.ctx).toBe("New");
    });
  });
});
