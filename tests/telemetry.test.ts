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
import { getCurrentSpan, METER_PROVIDER, record, telemetry } from "../src/telemetry";
import { resolveTelemetryOptions } from "../src/telemetry/options";
import { BufferSink, Logger, requestContext } from "../src/services/logger.service";

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
  test("creates a SERVER span with HTTP attributes and UNSET status on success", async () => {
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
      expect(span.status.code).toBe(SpanStatusCode.UNSET);
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

  test("preserves inbound W3C tracestate", async () => {
    const { app, exporter } = await boot();
    try {
      await app.handle(
        new Request("http://localhost/users/7", {
          headers: { traceparent: TRACEPARENT, tracestate: "vendor=value" },
        }),
      );
      expect(exporter.getFinishedSpans()[0]?.parentSpanContext?.traceState?.get("vendor")).toBe(
        "value",
      );
    } finally {
      await app.close();
    }
  });

  test("honors an unsampled inbound W3C parent", async () => {
    const { app, exporter } = await boot();
    try {
      await app.handle(
        new Request("http://localhost/users/7", {
          headers: { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-00` },
        }),
      );
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  test("does not leak the ended server span into caller work", async () => {
    const { app } = await boot();
    try {
      await app.handle(new Request("http://localhost/users/7"));
      expect(getCurrentSpan()).toBeUndefined();
      expect(requestContext.getStore()).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  test("separates server.address and server.port", async () => {
    const { app, exporter } = await boot();
    try {
      await app.handle(new Request("http://localhost:8080/users/7"));
      const span = exporter.getFinishedSpans()[0]!;
      expect(span.attributes["server.address"]).toBe("localhost");
      expect(span.attributes["server.port"]).toBe(8080);
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
      expect(span.attributes["error.type"]).toBe("500");
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
      expect(spans[0]!.name).toBe("GET");
      expect(spans[0]!.status.code).toBe(SpanStatusCode.UNSET);
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
      expect(getCurrentSpan()).toBeUndefined();
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
    expect(app.get(METER_PROVIDER)).toBeDefined();
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

    const durationMetric = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .find((metric) => metric.descriptor.name === "http.server.request.duration");
    expect((durationMetric?.dataPoints[0]?.attributes as any)?.["url.scheme"]).toBe("http");
    const activeMetric = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .find((metric) => metric.descriptor.name === "http.server.active_requests");
    expect(activeMetric?.descriptor.unit).toBe("{request}");
    expect((activeMetric?.dataPoints[0]?.attributes as any)?.["http.request.method"]).toBe("GET");
    expect((activeMetric?.dataPoints[0]?.attributes as any)?.["url.scheme"]).toBe("http");
  });

  test("records HTTP metrics when request spans are disabled", async () => {
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const exporter = new InMemorySpanExporter();
    const app = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
      plugins: [
        telemetry({
          enabled: true,
          instrumentRequests: false,
          metrics: true,
          spanExporter: exporter,
          metricExporter,
        }),
      ],
    });
    await app.listen(0);
    await app.handle(new Request("http://localhost/users/1"));
    await app.close();

    expect(exporter.getFinishedSpans()).toHaveLength(0);
    const names = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((metric) => metric.descriptor.name);
    expect(names).toContain("http.server.request.duration");
    expect(names).toContain("http.server.active_requests");
  });
});

describe("telemetry plugin — process ownership", () => {
  test("rejects a second active SDK instead of cross-wiring applications", async () => {
    const first = await boot();
    const secondExporter = new InMemorySpanExporter();
    const second = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
      plugins: [telemetry({ enabled: true, metrics: false, spanExporter: secondExporter })],
    });
    try {
      await expect(second.listen(0)).rejects.toThrow("already active");
    } finally {
      await second.close();
      await first.app.close();
    }
  });
});

describe("telemetry options", () => {
  test("derives per-signal paths from OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    const previous = Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const previousTraces = Bun.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const previousMetrics = Bun.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    try {
      Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318/base";
      delete Bun.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      delete Bun.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
      const resolved = resolveTelemetryOptions({});
      expect(resolved?.exporter.url).toBe("http://collector:4318/base/v1/traces");
      expect(resolved?.exporter.metricsUrl).toBe("http://collector:4318/base/v1/metrics");
    } finally {
      restoreEnv("OTEL_EXPORTER_OTLP_ENDPOINT", previous);
      restoreEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", previousTraces);
      restoreEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", previousMetrics);
    }
  });

  test("preserves the standard sampler variants", () => {
    const previousKind = Bun.env.OTEL_TRACES_SAMPLER;
    const previousArg = Bun.env.OTEL_TRACES_SAMPLER_ARG;
    const previousEndpoint = Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    try {
      Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
      Bun.env.OTEL_TRACES_SAMPLER = "traceidratio";
      Bun.env.OTEL_TRACES_SAMPLER_ARG = "0.25";
      expect(resolveTelemetryOptions({})?.sampler).toEqual({
        kind: "trace_id_ratio",
        ratio: 0.25,
      });

      Bun.env.OTEL_TRACES_SAMPLER = "parentbased_always_off";
      expect(resolveTelemetryOptions({})?.sampler).toEqual({
        kind: "parent_based",
        root: "always_off",
      });
    } finally {
      restoreEnv("OTEL_TRACES_SAMPLER", previousKind);
      restoreEnv("OTEL_TRACES_SAMPLER_ARG", previousArg);
      restoreEnv("OTEL_EXPORTER_OTLP_ENDPOINT", previousEndpoint);
    }
  });

  test("rejects an invalid programmatic sampling ratio", () => {
    expect(() => resolveTelemetryOptions({ enabled: true, sampler: { ratio: 2 } })).toThrow(
      "in [0,1]",
    );
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete Bun.env[name];
  else Bun.env[name] = value;
}
