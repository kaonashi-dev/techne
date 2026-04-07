export const QUEUE_MODULE_OPTIONS = Symbol("QUEUE_MODULE_OPTIONS");
export const QUEUE_DRIVER = Symbol("QUEUE_DRIVER");

export function getQueueToken(name: string): string {
  return `Queue_${name}`;
}
