/**
 * DI tokens for the telemetry plugin. Symbols (not classes) so they register
 * as value providers — resolve via `@Inject(TRACER)` / `app.get(TRACER)`.
 */
export const TELEMETRY_OPTIONS = Symbol("TELEMETRY_OPTIONS");
export const TRACER = Symbol("TRACER");
export const TRACER_PROVIDER = Symbol("TRACER_PROVIDER");
export const METER = Symbol("METER");
export const METER_PROVIDER = Symbol("METER_PROVIDER");
