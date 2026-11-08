// In-process token buckets. The pilot runs one API process, so memory is the right place.
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private takes = 0;

  constructor(
    private capacity: number,
    private perSecond: number,
    private now: () => number,
  ) {}

  /** Takes one token for `key`; returns the seconds to wait when none is left. */
  take(key: string): number | undefined {
    if (++this.takes % 1000 === 0) this.prune();
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (now - bucket.at) * this.perSecond);
    bucket.at = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return undefined;
    }
    return Math.max(1, Math.ceil((1 - bucket.tokens) / this.perSecond));
  }

  /** Forgets buckets that have refilled, so idle clients cost nothing. */
  private prune() {
    const now = this.now();
    for (const [key, bucket] of this.buckets)
      if (bucket.tokens + (now - bucket.at) * this.perSecond >= this.capacity)
        this.buckets.delete(key);
  }
}

export interface RateLimits {
  /** Every API request, per client address. */
  addressBurst: number;
  addressPerSecond: number;
  /** Sign-in requests, per client address. */
  signInBurst: number;
  signInPerMinute: number;
  /** Signed-in requests, per account. */
  accountBurst: number;
  accountPerSecond: number;
}

export const DEFAULT_LIMITS: RateLimits = {
  addressBurst: 600,
  addressPerSecond: 10,
  signInBurst: 10,
  signInPerMinute: 10,
  accountBurst: 300,
  accountPerSecond: 5,
};
