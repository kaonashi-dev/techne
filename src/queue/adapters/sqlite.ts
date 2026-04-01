import { Database } from "bun:sqlite";
import type { QueueAdapter, Job, EnqueueOptions, JobStatus } from "../types";

export class DBQueue implements QueueAdapter {
  private db: Database;
  private tableName: string;

  constructor(dbPath: string = "queue.db", tableName: string = "jobs") {
    this.db = new Database(dbPath);
    this.tableName = tableName;
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        maxAttempts INTEGER NOT NULL,
        error TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
  }

  private mapRowToJob(row: any): Job {
    return {
      id: row.id,
      payload: JSON.parse(row.payload),
      status: row.status as JobStatus,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      error: row.error || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  enqueue<T>(payload: T, options?: EnqueueOptions): Job<T> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const maxAttempts = options?.maxAttempts ?? 3;
    const status: JobStatus = "pending";

    const stmt = this.db.prepare(`
      INSERT INTO ${this.tableName} (id, payload, status, attempts, maxAttempts, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, JSON.stringify(payload), status, 0, maxAttempts, now, now);

    return {
      id,
      payload,
      status,
      attempts: 0,
      maxAttempts,
      createdAt: now,
      updatedAt: now,
    };
  }

  dequeue(): Job | null {
    // Transaction to safely get a job and lock it
    return this.db.transaction(() => {
      const stmt = this.db.prepare(`
        SELECT * FROM ${this.tableName}
        WHERE status = 'pending'
        ORDER BY createdAt ASC
        LIMIT 1
      `);

      const row = stmt.get() as any;

      if (!row) return null;

      const now = Date.now();
      const updateStmt = this.db.prepare(`
        UPDATE ${this.tableName}
        SET status = 'processing', updatedAt = ?
        WHERE id = ?
      `);
      updateStmt.run(now, row.id);

      row.status = "processing";
      row.updatedAt = now;

      return this.mapRowToJob(row);
    })();
  }

  complete(jobId: string): void {
    const stmt = this.db.prepare(`
      UPDATE ${this.tableName}
      SET status = 'completed', updatedAt = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), jobId);
  }

  fail(jobId: string, error: Error): void {
    const now = Date.now();
    const getStmt = this.db.prepare(
      `SELECT attempts, maxAttempts FROM ${this.tableName} WHERE id = ?`,
    );
    const job = getStmt.get(jobId) as { attempts: number; maxAttempts: number } | undefined;

    if (!job) return;

    const newAttempts = job.attempts + 1;
    let newStatus: JobStatus = "failed";

    if (newAttempts < job.maxAttempts) {
      newStatus = "pending";
    }

    const updateStmt = this.db.prepare(`
      UPDATE ${this.tableName}
      SET status = ?, attempts = ?, error = ?, updatedAt = ?
      WHERE id = ?
    `);

    updateStmt.run(newStatus, newAttempts, error.message, now, jobId);
  }

  size(): number {
    const stmt = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE status = 'pending'`,
    );
    const result = stmt.get() as { count: number };
    return result.count;
  }

  clear(): void {
    this.db.exec(`DELETE FROM ${this.tableName}`);
  }
}
