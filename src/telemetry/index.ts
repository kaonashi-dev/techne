import { Inject } from "../decorators/inject.decorator";
import { TRACER } from "./tokens";

/** Inject the active OpenTelemetry `Tracer` (a proxy until telemetry starts). */
export const InjectTracer = (): ParameterDecorator => Inject(TRACER);

export { telemetry } from "./plugin";
export { record, getCurrentSpan, setAttributes, getTracer } from "./helpers";
export { METER, METER_PROVIDER, TELEMETRY_OPTIONS, TRACER, TRACER_PROVIDER } from "./tokens";
export type {
  TelemetryOptions,
  TelemetryExporterOptions,
  TelemetrySamplerOptions,
  ResolvedTelemetryOptions,
} from "./options";
