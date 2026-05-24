import type { BatchStore } from "./batch-store";

let activeBatchStore: BatchStore | undefined;

/** Install the batch store. Called once during mq() plugin setup. */
export function setBatchStore(store: BatchStore): void {
  activeBatchStore = store;
}

/** Retrieve the active batch store, or undefined if not installed. */
export function getBatchStore(): BatchStore | undefined {
  return activeBatchStore;
}

/** Drop the batch store. For test cleanup / plugin shutdown. */
export function clearBatchStore(): void {
  activeBatchStore = undefined;
}
