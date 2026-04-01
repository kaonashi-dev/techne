export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface Job<T = any> {
  id: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EnqueueOptions {
  maxAttempts?: number;
}

export interface QueueAdapter {
  /** Adds a job to the queue */
  enqueue<T>(payload: T, options?: EnqueueOptions): Promise<Job<T>> | Job<T>;

  /** Retrieves and locks the next available job */
  dequeue(): Promise<Job | null> | Job | null;

  /** Marks a job as completed */
  complete(jobId: string): Promise<void> | void;

  /** Marks a job as failed, potentially retrying it */
  fail(jobId: string, error: Error): Promise<void> | void;

  /** Returns the number of pending jobs */
  size(): Promise<number> | number;

  /** Optional: clear the queue entirely */
  clear?(): Promise<void> | void;
}
