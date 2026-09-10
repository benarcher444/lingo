/**
 * A fixed-window counter per client, in memory. One process and a handful of
 * users need nothing more, and it keeps a dependency off the server.
 */
export function createLimiter(opts: { max: number; windowMs: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Counts an attempt. False once `key` is over its limit for this window. */
    allow(key: string, now = Date.now()): boolean {
      // Forget finished windows now and then, so the map cannot grow forever.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      }

      const current = windows.get(key);
      if (!current || current.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }

      current.count += 1;
      return current.count <= opts.max;
    },
  };
}

/**
 * A request from this machine itself: the test suites and screenshot runs,
 * which sign in dozens of times a minute. Never a visitor — behind the proxy
 * (see trustProxy in server.ts) every visitor arrives with their own address.
 */
export function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
