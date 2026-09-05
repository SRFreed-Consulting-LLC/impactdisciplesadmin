/**
 * A sliding-window request limiter, in memory, per warm instance.
 *
 * Deliberately modest: it is not a fleet-wide quota (each instance keeps
 * its own counts, and 2nd-gen instances serve 80 requests concurrently),
 * it is a brake on one caller hammering one endpoint - the coupon-code
 * oracle being the case in point. Pair it with `maxInstances` on the
 * function so the fleet cannot grow around it.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /**
   * @param {number} limit Requests allowed per key per window.
   * @param {number} windowMs The window, in milliseconds.
   */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /**
   * Records a request for `key` and says whether it is within the limit.
   * @param {string} key The caller - normally an IP address.
   * @param {number} now The clock, injectable for tests.
   * @return {boolean} True to allow, false to refuse.
   */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Bound the map: a warm instance that has seen ten thousand distinct
    // callers starts over rather than growing without limit.
    if (this.hits.size > 10000) {
      this.hits.clear();
    }
    return true;
  }
}

/**
 * The caller's address as the platform saw it. Cloud Functions sit behind
 * a proxy, so the client is the FIRST entry of x-forwarded-for; request.ip
 * is the proxy.
 * @param {object} request The incoming request.
 * @return {string} The address, or "unknown".
 */
export function clientIp(
  request: {headers: Record<string, unknown>; ip?: string}
): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ?
    String(forwarded[0]) :
    typeof forwarded === "string" ? forwarded.split(",")[0] : "";
  return (first || request.ip || "unknown").trim();
}
