import { describe, expect, it } from "vitest";
import {
  SegmentTranscriber,
  VOICE_LIMITS,
} from "../apps/web/lib/voice-stream.js";

const clip = () => new Blob(["TEST ONLY complete audio container"]);
describe("bounded incremental voice orchestration (mocked transcription)", () => {
  it("serializes complete segments, publishes genuine returned text in order and drains the final turn", async () => {
    const published: string[] = [],
      calls: string[] = [];
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new SegmentTranscriber({
      async transcribe() {
        calls.push("requested");
        if (calls.length === 1) await wait;
        return calls.length === 1 ? "عايز تركيا" : "خمسة أيام";
      },
      onText: (text) => {
        published.push(text);
      },
      onError: () => {
        throw Error("unexpected");
      },
    });
    expect(session.append(clip())).toBe(true);
    expect(session.append(clip())).toBe(true);
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    const done = session.finish();
    expect(session.append(clip())).toBe(false);
    release();
    expect(await done).toBe("عايز تركيا خمسة أيام");
    expect(published).toEqual(["عايز تركيا", "عايز تركيا خمسة أيام"]);
  });
  it("cancels in-flight work, drops queued audio and ignores late responses", async () => {
    let resolve = (_text: string) => {},
      signal: AbortSignal | undefined;
    const published: string[] = [];
    let calls = 0;
    const session = new SegmentTranscriber({
      transcribe: async (_blob, value) => {
        calls++;
        signal = value;
        return new Promise<string>((done) => {
          resolve = done;
        });
      },
      onText: (text) => {
        published.push(text);
      },
      onError: () => {
        throw Error("unexpected");
      },
    });
    session.append(clip());
    session.append(clip());
    await Promise.resolve();
    session.cancel();
    expect(signal?.aborted).toBe(true);
    resolve("late TEST ONLY");
    expect(await session.finish()).toBeNull();
    expect(calls).toBe(1);
    expect(published).toEqual([]);
  });
  it("stops on quota/failure without retries or pretending the remaining segment succeeded", async () => {
    let calls = 0;
    const errors: string[] = [],
      published: string[] = [];
    const session = new SegmentTranscriber({
      async transcribe() {
        calls++;
        if (calls === 2) throw Error("TEST ONLY quota");
        return "نص متاح";
      },
      onText: (text) => {
        published.push(text);
      },
      onError: (error, partial) => {
        errors.push(`${error.message}:${partial}`);
      },
    });
    session.append(clip());
    session.append(clip());
    expect(await session.finish()).toBeNull();
    expect(calls).toBe(2);
    expect(published).toEqual(["نص متاح"]);
    expect(errors).toEqual(["TEST ONLY quota:نص متاح"]);
    expect(session.append(clip())).toBe(false);
  });
  it("limits backpressure before starting another paid request", async () => {
    let calls = 0,
      errors = 0;
    const session = new SegmentTranscriber({
      async transcribe() {
        calls++;
        return "";
      },
      onText() {},
      onError() {
        errors++;
      },
    });
    session.append(clip());
    session.append(clip());
    expect(session.append(clip())).toBe(false);
    expect(await session.finish()).toBeNull();
    expect(calls).toBe(0);
    expect(errors).toBe(1);
  });
  it("caps a turn at six requests even if the queue drains quickly", async () => {
    let calls = 0,
      errors = 0;
    const session = new SegmentTranscriber({
      async transcribe() {
        calls++;
        return "جزء";
      },
      onText() {},
      onError() {
        errors++;
      },
    });
    for (let i = 0; i < VOICE_LIMITS.segments; i++) {
      expect(session.append(clip())).toBe(true);
      // Wait for each microtask chain without ending the turn.
      await new Promise((done) => setTimeout(done, 0));
    }
    expect(session.append(clip())).toBe(false);
    expect(await session.finish()).toBeNull();
    expect(calls).toBe(6);
    expect(errors).toBe(1);
  });
  it("rejects oversized audio before any provider request", async () => {
    let calls = 0;
    const session = new SegmentTranscriber({
      async transcribe() {
        calls++;
        return "";
      },
      onText() {},
      onError() {},
    });
    expect(
      session.append(new Blob([new Uint8Array(VOICE_LIMITS.bytes + 1)])),
    ).toBe(false);
    expect(await session.finish()).toBeNull();
    expect(calls).toBe(0);
  });
});
