import type { ConsoleCommandMeta } from "./types";

function toKebab(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

export function deriveCommandName(
  ctor: any,
  methodName: string,
  meta: ConsoleCommandMeta,
  methodCount: number,
): string {
  if (meta.name && meta.name !== methodName) return meta.name;

  const className: string = ctor.name ?? "Command";
  const base = toKebab(className.replace(/Command$/i, "")) || toKebab(className);

  if (methodCount > 1) return `${base}:${toKebab(methodName)}`;
  return base;
}
