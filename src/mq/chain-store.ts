import type { ChainStepSpec, RedisClientAdapter } from "./types";

export interface ChainStore {
  save(chainId: string, remainingSteps: ChainStepSpec[], catchSpec?: ChainStepSpec): Promise<void>;
  next(chainId: string): Promise<ChainStepSpec | null>;
  catch(chainId: string): Promise<ChainStepSpec | null>;
  cleanup(chainId: string): Promise<void>;
}

interface ChainEntry {
  steps: ChainStepSpec[];
  catchSpec?: ChainStepSpec;
}

export class MemoryChainStore implements ChainStore {
  private store = new Map<string, ChainEntry>();

  async save(chainId: string, steps: ChainStepSpec[], catchSpec?: ChainStepSpec): Promise<void> {
    this.store.set(chainId, { steps: [...steps], catchSpec });
  }

  async next(chainId: string): Promise<ChainStepSpec | null> {
    const entry = this.store.get(chainId);
    if (!entry || entry.steps.length === 0) return null;
    const next = entry.steps.shift()!;
    if (entry.steps.length === 0 && !entry.catchSpec) this.store.delete(chainId);
    return next;
  }

  async catch(chainId: string): Promise<ChainStepSpec | null> {
    return this.store.get(chainId)?.catchSpec ?? null;
  }

  async cleanup(chainId: string): Promise<void> {
    this.store.delete(chainId);
  }
}

export class RedisChainStore implements ChainStore {
  constructor(private readonly client: RedisClientAdapter) {}

  private key(chainId: string): string {
    return `chain:${chainId}`;
  }

  async save(chainId: string, steps: ChainStepSpec[], catchSpec?: ChainStepSpec): Promise<void> {
    const entry: ChainEntry = { steps, catchSpec };
    await this.client.set(this.key(chainId), JSON.stringify(entry));
  }

  async next(chainId: string): Promise<ChainStepSpec | null> {
    const raw = await this.client.get(this.key(chainId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as ChainEntry;
    if (!entry.steps || entry.steps.length === 0) return null;
    const next = entry.steps.shift()!;
    if (entry.steps.length === 0 && !entry.catchSpec) {
      await this.client.del(this.key(chainId));
    } else {
      await this.client.set(this.key(chainId), JSON.stringify(entry));
    }
    return next;
  }

  async catch(chainId: string): Promise<ChainStepSpec | null> {
    const raw = await this.client.get(this.key(chainId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as ChainEntry;
    return entry.catchSpec ?? null;
  }

  async cleanup(chainId: string): Promise<void> {
    await this.client.del(this.key(chainId));
  }
}
