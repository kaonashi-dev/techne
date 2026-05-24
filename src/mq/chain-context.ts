import type { ChainStore } from "./chain-store";

let activeChainStore: ChainStore | undefined;

export function setChainStore(store: ChainStore): void {
  activeChainStore = store;
}

export function getChainStore(): ChainStore | undefined {
  return activeChainStore;
}

export function clearChainStore(): void {
  activeChainStore = undefined;
}
