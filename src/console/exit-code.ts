export enum ExitCode {
  SUCCESS = 0,
  ERROR = 1,
  INVALID = 2,
}

/** void/undefined → SUCCESS; number → clamp 0..255; ExitCode → its value. */
export function normalizeExitCode(ret: unknown): number {
  if (ret === undefined || ret === null) return ExitCode.SUCCESS;
  if (typeof ret === "number" && Number.isFinite(ret)) return Math.max(0, Math.min(255, ret | 0));
  return ExitCode.SUCCESS;
}
