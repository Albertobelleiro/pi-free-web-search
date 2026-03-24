export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class OperationAbortedError extends Error {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "OperationAbortedError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new OperationAbortedError();
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof OperationAbortedError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    return /abort|cancel/i.test(error.name) || /abort|cancel/i.test(error.message);
  }
  return false;
}

export function isTimeoutError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TimeoutError) return true;
  if (error instanceof Error) return /timed out|timeout/i.test(error.message);
  return false;
}

export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeoutError: TimeoutError | undefined;

  const timeout = setTimeout(() => {
    timeoutError = new TimeoutError(label, timeoutMs);
    controller.abort(timeoutError);
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason ?? new OperationAbortedError());
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timeout);
      throw new OperationAbortedError();
    }
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  try {
    return await work(controller.signal);
  } catch (error) {
    if (timeoutError && isAbortError(error)) throw timeoutError;
    if (parentSignal?.aborted && isAbortError(error)) throw new OperationAbortedError();
    throw error;
  } finally {
    clearTimeout(timeout);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
  }
}
