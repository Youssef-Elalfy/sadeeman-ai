/** Bounded application-level incremental transcription, not provider-native streaming.
 * Every input must be an independently decodable recording with its own header.
 * No audio or transcript is persisted here, and no failed request is retried.
 */
export const STOP_VOICE_OUTPUT = "sadeeman:stop-voice-output";
export const VOICE_LIMITS = {
  segments: 6,
  segmentMs: 10000,
  pending: 2,
  bytes: 5000000,
  characters: 16000,
} as const;

export class SegmentTranscriber {
  private readonly abort = new AbortController();
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private count = 0;
  private bytes = 0;
  private text = "";
  private ended = false;
  private failed = false;
  constructor(
    private readonly options: {
      transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
      onText: (text: string) => void;
      onError: (error: Error, partial: string) => void;
    },
  ) {}
  append(audio: Blob): boolean {
    if (this.ended || this.failed || this.abort.signal.aborted) return false;
    if (
      !audio.size ||
      this.count >= VOICE_LIMITS.segments ||
      this.pending >= VOICE_LIMITS.pending ||
      this.bytes + audio.size > VOICE_LIMITS.bytes
    ) {
      this.fail(
        new Error(
          "وصلنا لحد التسجيل أو التحويل؛ راجع النص المتاح أو كمّل كتابة.",
        ),
      );
      return false;
    }
    this.count++;
    this.pending++;
    this.bytes += audio.size;
    this.tail = this.tail.then(async () => {
      try {
        if (this.failed || this.abort.signal.aborted) return;
        const text = (
          await this.options.transcribe(audio, this.abort.signal)
        ).trim();
        if (this.failed || this.abort.signal.aborted) return;
        const combined = [this.text, text].filter(Boolean).join(" ");
        if (combined.length > VOICE_LIMITS.characters)
          throw new Error("النص أطول من الحد المتاح؛ راجع الجزء اللي اتحوّل.");
        this.text = combined;
        this.options.onText(this.text);
      } catch (error) {
        if (!this.abort.signal.aborted)
          this.fail(
            error instanceof Error
              ? error
              : new Error("تعذر تحويل الجزء الأخير؛ راجع النص المتاح."),
          );
      } finally {
        this.pending--;
      }
    });
    return true;
  }
  async finish(): Promise<string | null> {
    this.ended = true;
    await this.tail;
    return this.failed || this.abort.signal.aborted ? null : this.text;
  }
  cancel() {
    this.ended = true;
    this.abort.abort();
  }
  private fail(error: Error) {
    if (this.failed || this.abort.signal.aborted) return;
    this.failed = true;
    this.abort.abort();
    this.options.onError(error, this.text);
  }
}
