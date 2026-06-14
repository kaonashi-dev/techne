import type { Tracer } from "@opentelemetry/api";

/**
 * A `Tracer` that forwards to the real tracer once telemetry starts in
 * `onReady`. The plugin provides this under the `TRACER` token during
 * `setup` (which runs at boot, before the SDK exists) so boot-time singletons
 * can safely `@Inject(TRACER)`. Actual use happens per request, long after the
 * delegate is wired up.
 */
export class ProxyTracer implements Tracer {
  private delegate?: Tracer;

  setDelegate(tracer: Tracer): void {
    this.delegate = tracer;
  }

  startSpan(...args: Parameters<Tracer["startSpan"]>): ReturnType<Tracer["startSpan"]> {
    if (!this.delegate) throw new Error(BOOT_USE_MESSAGE);
    return this.delegate.startSpan(...args);
  }

  // The `startActiveSpan` overloads are awkward to re-declare; forward as-is.
  startActiveSpan(...args: unknown[]): unknown {
    if (!this.delegate) throw new Error(BOOT_USE_MESSAGE);
    return (this.delegate.startActiveSpan as (...a: unknown[]) => unknown)(...args);
  }
}

const BOOT_USE_MESSAGE =
  "Tracer used before telemetry started (onReady). Inject it and use it inside request handlers or after the app starts.";
