export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackoffOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  jitterMs?: number;
}

export async function withExponentialBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseMs = options.baseMs ?? 400;
  const maxMs = options.maxMs ?? 8_000;
  const jitterMs = options.jitterMs ?? 200;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * jitterMs);
      await sleep(delay + jitter);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "backoff failed"));
}
