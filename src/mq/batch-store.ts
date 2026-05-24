import type { BatchCallbacks } from "./types";

export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  cancelled: boolean;
}

export interface BatchStore {
  create(batchId: string, total: number, callbacks: BatchCallbacks): Promise<void>;
  incrementCompleted(batchId: string): Promise<BatchProgress>;
  incrementFailed(batchId: string): Promise<BatchProgress>;
  incrementTotal(batchId: string, delta: number): Promise<void>;
  cancel(batchId: string): Promise<void>;
  isCancelled(batchId: string): Promise<boolean>;
  getCallbacks(batchId: string): Promise<BatchCallbacks | null>;
  getState(batchId: string): Promise<BatchProgress | null>;
  cleanup(batchId: string): Promise<void>;
}

interface BatchState {
  total: number;
  completed: number;
  failed: number;
  cancelled: boolean;
  callbacks: BatchCallbacks;
}

export class MemoryBatchStore implements BatchStore {
  private store = new Map<string, BatchState>();

  async create(batchId: string, total: number, callbacks: BatchCallbacks): Promise<void> {
    this.store.set(batchId, { total, completed: 0, failed: 0, cancelled: false, callbacks });
  }

  async incrementCompleted(batchId: string): Promise<BatchProgress> {
    const s = this.store.get(batchId)!;
    s.completed++;
    return { completed: s.completed, failed: s.failed, total: s.total, cancelled: s.cancelled };
  }

  async incrementFailed(batchId: string): Promise<BatchProgress> {
    const s = this.store.get(batchId)!;
    s.failed++;
    return { completed: s.completed, failed: s.failed, total: s.total, cancelled: s.cancelled };
  }

  async incrementTotal(batchId: string, delta: number): Promise<void> {
    const s = this.store.get(batchId);
    if (s) s.total += delta;
  }

  async cancel(batchId: string): Promise<void> {
    const s = this.store.get(batchId);
    if (s) s.cancelled = true;
  }

  async isCancelled(batchId: string): Promise<boolean> {
    return this.store.get(batchId)?.cancelled ?? false;
  }

  async getCallbacks(batchId: string): Promise<BatchCallbacks | null> {
    return this.store.get(batchId)?.callbacks ?? null;
  }

  async getState(batchId: string): Promise<BatchProgress | null> {
    const s = this.store.get(batchId);
    if (!s) return null;
    return { total: s.total, completed: s.completed, failed: s.failed, cancelled: s.cancelled };
  }

  async cleanup(batchId: string): Promise<void> {
    this.store.delete(batchId);
  }
}
