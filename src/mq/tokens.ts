export const MQ_MODULE_OPTIONS = Symbol("MQ_MODULE_OPTIONS");
export const MQ_DRIVER = Symbol("MQ_DRIVER");

export function getMqToken(name: string): string {
  return `Mq_${name}`;
}
