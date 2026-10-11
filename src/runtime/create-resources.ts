export type Cleanup = () => void | Promise<void>;
export type OnClose = (cleanup: Cleanup) => void;

/** App-owned resources. Pass `value` explicitly to services and feature factories. */
export interface Resources<T> extends AsyncDisposable {
  readonly value: T;
  /** Idempotent, reverse-order disposal. All cleanups run even if one fails. */
  close(): Promise<void>;
}

/**
 * Acquire resources once, outside the request path.
 * Register cleanup immediately after each successful acquisition. A failed setup
 * rolls back everything already registered, preserving setup and cleanup errors.
 */
export async function createResources<T>(
  setup: (onClose: OnClose) => T | Promise<T>,
): Promise<Resources<T>> {
  const cleanups: Cleanup[] = [];
  let accepting = true;
  let closing: Promise<void> | undefined;

  const onClose: OnClose = (cleanup) => {
    if (!accepting) throw new Error("Register resource cleanup during setup, before it completes.");
    cleanups.push(cleanup);
  };

  const close = (): Promise<void> => {
    if (closing) return closing;
    accepting = false;
    // Schedule after assigning `closing`, so simultaneous calls share one promise.
    closing = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      while (cleanups.length > 0) {
        try {
          await cleanups.pop()!();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, "Resource cleanup failed");
    });
    return closing;
  };

  try {
    const value = await setup(onClose);
    accepting = false;
    return { value, close, [Symbol.asyncDispose]: close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, ...(cleanupError as AggregateError).errors],
        "Resource setup and rollback failed",
        { cause: error },
      );
    }
    throw error;
  }
}
