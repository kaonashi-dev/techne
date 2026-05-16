export type TechneMode = "all" | "server" | "worker";

export function resolveTechneMode(override?: TechneMode): TechneMode {
  const raw = override ?? process.env.TECHNE_MODE ?? "all";
  if (raw !== "all" && raw !== "server" && raw !== "worker") {
    throw new Error(`Invalid TECHNE_MODE "${raw}". Must be "all", "server", or "worker".`);
  }
  return raw as TechneMode;
}
