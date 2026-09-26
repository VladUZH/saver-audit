// Test helper: temporarily set environment variables.

/** Runs fn with these environment variables set (undefined: unset), then restores them. */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const set = (v: Record<string, string | undefined>) => {
    for (const [k, x] of Object.entries(v)) if (x === undefined) delete process.env[k];
    else process.env[k] = x;
  };
  set(vars);
  try {
    return await fn();
  } finally {
    set(old);
  }
}
