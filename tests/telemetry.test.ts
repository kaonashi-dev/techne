import { afterEach, describe, expect, test } from "bun:test";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body } from "../src/decorators/params.decorator";
import { Dto, IsString } from "../src/schema";
import { HttpException } from "../src/exceptions";
import { record, telemetry } from "../src/telemetry";
import { BufferSink, Logger } from "../src/services/logger.service";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const PARENT_SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`;

// onAfterResponse runs in a deferred setImmediate; give it a turn to flush.
const flushMacrotask = () => new Promise((r) => setTimeout(r, 10));

@Dto()
class CreateUserDto {
  @IsString({ minLength: 2 })
  name!: string;
}

@Controller("users")
class UsersController {
  private readonly logger = new Logger("UsersController");

  @Get("/:id")
  get() {
    return { ok: true };
  }

  @Get("/boom/fail")
  boom() {
    throw new Error("kaboom");
  }

  @Get("/teapot/short")
  teapot() {
    throw new HttpException("I am a teapot", 418, { code: "TEAPOT" });
  }

  @Get("/logged/line")
  logged() {
    this.logger.log("inside-handler");
    return { ok: true };
  }

  @Get("/nested/child")
  async nested() {
    await record("work.unit", () => "done");
    return { ok: true };
  }

  @Post("/")
  create(@Body(CreateUserDto) body: CreateUserDto) {
    return { name: body.name };
  }
}

async function boot(opts: Record<string, unknown> = {}, loggerEnabled = false) {
  const exporter = new InMemorySpanExporter();
  const app = await TechneFactory.create({
    controllers: [UsersController],
    logger: loggerEnabled,
    plugins: [
      telemetry({
        enabled: true,
        serviceName: "test-svc",
        metrics: false,
        spanExporter: exporter,
        ...opts,
      }),
    ],
  });
  // listen(0) fires the plugin onReady (which starts the SDK) without binding a socket.
  await app.listen(0);
  return { app, exporter };
}

describe("telemetry plugin — tracing", () => {
  test("creates a SERVER span with HTTP attributes and OK status on success", async () => {
    const { app, exporter } = await boot();
    try {
      const res = await app.handle(new Request("http://localhost/users/42"));
      expect(res.status).toBe(200);

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);
      const span = spans[0]!;
      expect(span.name).toBe("GET /users/:id");
      expect(span.kind).toBe(SpanKind.SERVER);
      expect(span.attributes["http.request.method"]).toBe("GET");
      expect(span.attributes["http.route"]).toBe("/users/:id");
      expect(span.attributes["url.path"]).toBe("/users/42");
      expect(span.attributes["http.response.status_code"]).toBe(200);
      expect(span.status.code).toBe(SpanStatusCode.OK);
    } finally {
      await app.close();
    }
  });

  test("links to the inbound W3C traceparent as the remote parent", async () => {
    const { app, exporter } = await boot();
    try {
      await app.handle(
        new Request("http://localhost/users/7", { headers: { traceparent: TRACEPARENT } }),
      );
      const span = exporter.getFinishedSpans()[0]!;
      expect(span.spanContext().traceId).toBe(TRACE_ID);
      expect(span.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID);
    } finally {
      await app.close();
    }
  });

  test("records the exception and ERROR status on a thrown error", async () => {
    const { app, exporter } = await boot();
    try {
      const res = await app.handle(new Request("http://localhost/users/boom/fail"));
      expect(res.status).toBe(500);

      const span = exporter.getFinishedSpans()[0]!;
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.attributes["http.response.status_code"]).toBe(500);
      const exception = span.events.find((e) => e.name === "exception");
      expect(exception).toBeDefined();
      expect(exception?.attributes?.["exception.message"]).toBe("kaboom");
    } finally {
      await app.close();
    }
  });

  test("uses the HttpException status for the span", async () => {
    const { app, exporter } = await boot();
    try {
      const res = await app.handle(new Request("http://localhost/users/teapot/short"));
      expect(res.status).toBe(418);
      const span = exporter.getFinishedSpans()[0]!;
      expect(span.attributes["http.response.status_code"]).toBe(418);
    } finally {
      await app.close();
    }
  });

  test("ends a span for a 404 (no route matched)", async () => {
    const { app, exporter } = await boot();
    try {
      const res = await app.handle(new Request("http://localhost/nope/nope"));
      expect(res.status).toBe(404);
      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);
      expect(spans[0]!.attributes["http.response.status_code"]).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("ends a validation-error span (422) via the deferred fallback", async () => {
    const { app, exporter } = await boot();
    try {
      const res = await app.handle(
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x" }), // too short -> 422
        }),
      );
      expect(res.status).toBe(422);
      await flushMacrotask();
      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBe(1);
      expect(spans[0]!.attributes["http.response.status_code"]).toBe(422);
    } finally {
      await app.close();
    }
  });

  test("record() creates a child span nested under the server span", async () => {
    const { app, exporter } = await boot();
    try {
      await app.handle(new Request("http://localhost/users/nested/child"));
      const spans = exporter.getFinishedSpans();
      const server = spans.find((s) => s.name === "GET /users/nested/child")!;
      const child = spans.find((s) => s.name === "work.unit")!;
      expect(server).toBeDefined();
      expect(child).toBeDefined();
      expect(child.spanContext().traceId).toBe(server.spanContext().traceId);
      expect(child.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
    } finally {
      await app.close();
    }
  });
});

describe("telemetry plugin — log/span correlation", () => {
  test("logs carry the EMITTED server span id", async () => {
    const { app, exporter } = await boot({}, true);
    const prevSink = Logger.getSink();
    const prevMode = Logger.getMode();
    const buffer = new BufferSink();
    Logger.setSink(buffer);
    Logger.setMode("json");
    try {
      await app.handle(new Request("http://localhost/users/logged/line"));
      const span = exporter.getFinishedSpans()[0]!;
      const emittedSpanId = span.spanContext().spanId;

      const handlerLine = buffer.lines.find((l) => l.includes("inside-handler"));
      expect(handlerLine).toBeDefined();
      const record = JSON.parse(handlerLine!);
      expect(record.traceId).toBe(span.spanContext().traceId);
      expect(record.spanId).toBe(emittedSpanId);
    } finally {
      Logger.setSink(prevSink);
      Logger.setMode(prevMode);
      await app.close();
    }
  });
});

describe("telemetry plugin — metrics", () => {
  test("records default HTTP metrics, flushed on shutdown", async () => {
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const exporter = new InMemorySpanExporter();
    const app = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
      plugins: [
        telemetry({
          enabled: true,
          serviceName: "test-svc",
          metrics: true,
          spanExporter: exporter,
          metricExporter,
        }),
      ],
    });
    await app.listen(0);
    await app.handle(new Request("http://localhost/users/1"));
    // close() force-flushes the meter provider into the in-memory exporter.
    await app.close();

    const names = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((m) => m.descriptor.name);
    expect(names).toContain("http.server.request.duration");
    expect(names).toContain("http.server.request.count");
    expect(names).toContain("http.server.active_requests");
  });
});

describe("telemetry plugin — disabled", () => {
  afterEach(() => {
    // record() should be inert once no app has telemetry running.
    expect(record("noop", () => 123)).toBe(123);
  });

  test("registers nothing and emits no spans when enabled:false", async () => {
    const exporter = new InMemorySpanExporter();
    const app = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
      plugins: [telemetry({ enabled: false, spanExporter: exporter })],
    });
    await app.listen(0);
    try {
      const res = await app.handle(new Request("http://localhost/users/1"));
      expect(res.status).toBe(200);
      expect(exporter.getFinishedSpans().length).toBe(0);
    } finally {
      await app.close();
    }
  });
});
