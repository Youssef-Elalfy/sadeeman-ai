import { SafeError } from "./errors.js";

type Operation = "agent" | "voice" | "guest";
/** Aggregate, non-refundable admission limits for a single API replica.
 * Client-supplied IPs and newly created identities cannot reset these limits.
 * Restarts reset the window; deployment must remain single-replica until a
 * shared limiter is introduced. No contents, credentials or user IDs are kept.
 */
export class ProviderAdmission {
  private since: number;
  private active = 0;
  private counts: Record<Operation, number> = { agent: 0, voice: 0, guest: 0 };
  constructor(
    private readonly limits: Record<Operation, number>,
    private readonly concurrency: number,
    private readonly now: () => number = Date.now,
  ) {
    this.since = now();
  }
  acquire(operation: Operation): () => void {
    const now = this.now();
    if (now - this.since >= 3_600_000) {
      this.since = now;
      this.counts = { agent: 0, voice: 0, guest: 0 };
    }
    if (
      this.counts[operation] >= this.limits[operation] ||
      this.active >= this.concurrency
    )
      throw new SafeError("CAPACITY", 429);
    this.counts[operation]++;
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}
