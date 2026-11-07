"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { ApiFailure, api, headers } from "../lib/api";
import { speechText } from "../lib/speech-text";
import {
  SegmentTranscriber,
  STOP_VOICE_OUTPUT,
  VOICE_LIMITS,
} from "../lib/voice-stream";

const Capability = z.object({
  transcription: z.boolean(),
  speech: z.boolean(),
  fullDuplex: z.boolean(),
  incrementalTranscription: z.boolean().default(false),
  audioRetention: z.string(),
});
async function requestTranscription(
  blob: Blob,
  language: "ar" | "en",
  signal: AbortSignal,
) {
  if (blob.size > VOICE_LIMITS.bytes)
    throw Error("التسجيل كبير؛ اختصره لأقل من دقيقة.");
  const encoded = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("تعذر قراءة الصوت"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return api(
    "/voice/transcribe",
    z.object({ text: z.string(), empty: z.boolean() }),
    "POST",
    {
      audioBase64: encoded,
      mime: blob.type.split(";")[0],
      language,
      consent: true,
    },
    signal,
  );
}
export function VoicePanel({
  onTranscript,
  onSend,
  onClose,
  language,
}: {
  onTranscript: (text: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
  language: "ar" | "en";
}) {
  const [cap, setCap] = useState<z.infer<typeof Capability> | null>(null),
    [phase, setPhase] = useState("idle"),
    [error, setError] = useState(""),
    [transcript, setTranscript] = useState(""),
    [amplitude, setAmplitude] = useState(0),
    [seconds, setSeconds] = useState(0);
  const stream = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    audio = useRef<AudioContext | null>(null),
    controller = useRef<AbortController | null>(null),
    segments = useRef<SegmentTranscriber | null>(null),
    ending = useRef(false),
    cancelled = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    segmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    frame = useRef(0);
  // Incremental segment transcription stays available in code but is not
  // offered in the simplified inline recorder.
  const incremental = false;
  useVoiceSignal("mic", phase);
  useEffect(() => {
    if (phase !== "recording") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  const release = useCallback(() => {
    stream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    stream.current = null;
    void audio.current?.close();
    audio.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (segmentTimer.current) clearTimeout(segmentTimer.current);
    cancelAnimationFrame(frame.current);
  }, []);
  // Start capture immediately on click; never wait for the capability call.
  useEffect(() => {
    void startRef.current();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void api("/voice/capabilities", Capability, "GET", undefined, abort.signal)
      .then((c) => {
        setCap(c);
        if (!c.transcription) {
          // Capture already started; stop it, nothing could transcribe it.
          cancelled.current = true;
          if (recorder.current?.state === "recording") recorder.current.stop();
          release();
          setPhase("idle");
          setError(
            "تحويل الصوت لنص مش مفعّل على الخادم. لتفعيله: ENABLE_VOICE=true في ملف ‎.env‎ مع GROQ_API_KEY، وأعد التشغيل. الكتابة متاحة دايمًا.",
          );
        }
      })
           .catch(() => undefined);    return () => {
      abort.abort();
      cancelled.current = true;
      controller.current?.abort();
      segments.current?.cancel();
      recorder.current?.state === "recording" && recorder.current.stop();
      release();
    };
  }, [release]);
  async function transcribe(blob: Blob) {
    lastBlob.current = blob;
    if (blob.size > 5000000) {
      setError("التسجيل كبير؛ اختصره لأقل من دقيقة.");
      return;
    }
    setPhase("transcribing");
    controller.current = new AbortController();
    try {
      const response = await requestTranscription(
        blob,
        language,
        controller.current.signal,
      );
      if (cancelled.current) return;
      setTranscript(response.text);
      lastBlob.current = null;
      setPhase("review");
      if (response.empty)
        setError("مسمعتش كلام واضح. جرّب تاني أو اكتب رسالتك.");
    } catch (e) {
      if (!cancelled.current) {
        setPhase("idle");
        setError(e instanceof Error ? e.message : "الصوت مش متاح؛ كمّل كتابة.");
      }
    }
  }
  const startRef = useRef<() => Promise<void>>(async () => {});
  // The last recording is kept until it is transcribed, so a failure can retry.
  const lastBlob = useRef<Blob | null>(null);
  startRef.current = start;
  async function start() {
    cancelled.current = false;
    ending.current = false;
    segments.current?.cancel();
    segments.current = null;
    setTranscript("");
    setError("");
    setPhase("permission");
    window.dispatchEvent(new Event(STOP_VOICE_OUTPUT));
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error("المتصفح مش بيدعم التسجيل. تقدر ترفع ملف صوت أو تكتب.");
      const source = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelled.current) {
        source.getTracks().forEach((t) => {
          t.stop();
        });
        return;
      }
      stream.current = source;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) throw Error("صيغة التسجيل مش مدعومة. جرّب رفع ملف WAV.");
      const live = incremental && cap?.incrementalTranscription;
      let bytes = 0,
        windows = 0,
        windowHeard = false,
        heard = false,
        silence = 0;
      const started = Date.now();
      const fail = (message: string, partial = "") => {
        cancelled.current = true;
        segments.current?.cancel();
        if (recorder.current?.state === "recording") recorder.current.stop();
        release();
        setAmplitude(0);
        setTranscript(partial);
        setPhase(partial ? "review" : "idle");
        setError(message);
      };
      if (live)
        segments.current = new SegmentTranscriber({
          transcribe: async (blob, signal) =>
            (await requestTranscription(blob, language, signal)).text,
          onText: (text) => {
            if (!cancelled.current) setTranscript(text);
          },
          onError: (error, partial) =>
            fail(
              `${error.message} الجزء الأخير غير مؤكد؛ راجع النص المتاح.`,
              partial,
            ),
        });
      const capture = () => {
        // Each recorder starts a fresh complete container. MediaRecorder's
        // timeslice fragments alone are not independently decodable files.
        const r = new MediaRecorder(source, { mimeType: mime });
        recorder.current = r;
        const chunks: Blob[] = [];
        windowHeard = false;
        r.ondataavailable = (event) => {
          bytes += event.data.size;
          if (bytes > VOICE_LIMITS.bytes)
            fail("وصلنا للحد الأقصى لحجم التسجيل.");
          else chunks.push(event.data);
        };
        r.onerror = () => fail("حصل خطأ في الميكروفون. تقدر تكمل كتابة.");
        r.onstop = () => {
          if (segmentTimer.current) clearTimeout(segmentTimer.current);
          if (cancelled.current) {
            release();
            return;
          }
          const blob = new Blob(chunks, { type: mime });
          if (live) {
            windows++;
            if (windowHeard && !segments.current?.append(blob)) return;
            if (!ending.current && windows < VOICE_LIMITS.segments) {
              try {
                capture();
              } catch {
                fail("تعذر استكمال التسجيل. راجع النص المتاح أو كمّل كتابة.");
              }
              return;
            }
            release();
            setAmplitude(0);
            setPhase("transcribing");
            void segments.current?.finish().then((text) => {
              if (text === null || cancelled.current) return;
              setTranscript(text);
              setPhase(text ? "review" : "idle");
              if (!text) setError("مسمعتش كلام واضح. جرّب تاني أو اكتب رسالتك.");
            });
          } else {
            release();
            setAmplitude(0);
            if (heard) void transcribe(blob);
            else {
              setPhase("idle");
              setError("مسمعتش كلام واضح؛ مفيش صوت اتبعت للتحويل.");
            }
          }
        };
        r.start(500);
        if (live)
          segmentTimer.current = setTimeout(() => {
            if (windows + 1 >= VOICE_LIMITS.segments) ending.current = true;
            if (r.state === "recording") r.stop();
          }, VOICE_LIMITS.segmentMs);
      };
      audio.current = new AudioContext();
      const analyser = audio.current.createAnalyser();
      analyser.fftSize = 256;
      audio.current.createMediaStreamSource(source).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const measure = () => {
        analyser.getByteTimeDomainData(samples);
        const level = Math.sqrt(
          samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
            samples.length,
        );
        setAmplitude(Math.min(1, level * 6));
        if (level > 0.02) {
          heard = true;
          windowHeard = true;
          silence = 0;
        } else if (heard) {
          silence ||= Date.now();
          if (Date.now() - silence > 1500) {
            stopRecording();
            return;
          }
        }
        if (!heard && Date.now() - started > 8000) {
          stopRecording();
          return;
        }
        frame.current = requestAnimationFrame(measure);
      };
      capture();
      setPhase("recording");
      measure();
      timer.current = setTimeout(() => {
        stopRecording();
      }, 60000);
    } catch (e) {
      cancelled.current = true;
      segments.current?.cancel();
      release();
      setPhase("idle");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "الميكروفون مقفول؛ اسمح له من إعدادات المتصفح أو اكتب رسالتك."
          : e instanceof Error
            ? e.message
            : "تعذر تشغيل الميكروفون.",
      );
    }
  }
  function stopRecording() {
    ending.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  function cancel() {
    cancelled.current = true;
    controller.current?.abort();
    segments.current?.cancel();
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
    setPhase("idle");
    onClose();
  }
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <section className="voice-strip" aria-label="تسجيل صوتي" data-phase={phase}>
      {phase === "permission" && (
        <div className="voice-row">
          <p role="status">مستني إذن الميكروفون…</p>
          <button type="button" onClick={cancel}>
            إلغاء
          </button>
        </div>
      )}
      {phase === "recording" && (
        <div className="voice-row">
          <span className="rec-dot" aria-hidden="true" />
          <p role="status">
            بيسجّل… <bdi dir="ltr">{clock}</bdi>
          </p>
          <meter
            min={0}
            max={1}
            value={amplitude}
            aria-label="مستوى صوت الميكروفون"
          />
          <button type="button" className="primary" onClick={stopRecording}>
            إيقاف
          </button>
          <button type="button" onClick={cancel} aria-label="إلغاء التسجيل">
            إلغاء
          </button>
        </div>
      )}
      {phase === "transcribing" && (
        <div className="voice-row">
          <span className="spinner" aria-hidden="true" />
          <p role="status">بنحوّل كلامك لنص…</p>
          <button type="button" onClick={cancel}>
            إلغاء
          </button>
        </div>
      )}
      {phase === "review" && (
        <div className="voice-review">
          <label htmlFor="voice-transcript">راجع النص وعدّله</label>
          <textarea
            id="voice-transcript"
            rows={2}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
          <div className="voice-row">
            <button
              type="button"
              className="primary"
              disabled={!transcript.trim()}
              onClick={() => {
                onSend(transcript);
                cancel();
              }}
            >
              إرسال
            </button>
            <button
              type="button"
              disabled={!transcript.trim()}
              onClick={() => {
                onTranscript(transcript);
                cancel();
              }}
            >
              استخدام النص في الرسالة
            </button>
            <button type="button" onClick={cancel}>
              إلغاء
            </button>
          </div>
        </div>
      )}
      {phase === "idle" && (
        <div className="voice-row">
          {error ? (
            <p role="alert" className="voice-error">
              {error}
            </p>
          ) : (
            <p role="status">الميكروفون جاهز.</p>
          )}
          {lastBlob.current && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                const blob = lastBlob.current;
                setError("");
                cancelled.current = false;
                if (blob) void transcribe(blob);
              }}
            >
              إعادة المحاولة
            </button>
          )}
          {cap?.transcription !== false && (
            <button type="button" onClick={() => void start()}>
              تسجيل تاني
            </button>
          )}
          <button type="button" onClick={cancel} aria-label="إغلاق الصوت">
            إغلاق
          </button>
        </div>
      )}
      {phase !== "idle" && error && (
        <p role="alert" className="voice-error">
          {error}
        </p>
      )}
    </section>
  );
}
/**
 * Broadcasts the real microphone/playback phase so the ambient 3D presence can
 * reflect genuine activity (listening/speaking) without prop-drilling through
 * every message. Only actual MediaRecorder / audio element phases are sent.
 */
export const voiceSignal = "sadeeman:voice";
export type VoiceSignal = {
  id: string;
  source: "mic" | "speech";
  phase: string;
};
function useVoiceSignal(source: VoiceSignal["source"], phase: string) {
  const id = useId();
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<VoiceSignal>(voiceSignal, {
        detail: { id, source, phase },
      }),
    );
  }, [id, source, phase]);
  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent<VoiceSignal>(voiceSignal, {
          detail: { id, source, phase: "idle" },
        }),
      );
    },
    [id, source],
  );
}
/** One shared, cached capability lookup for every Listen button. */
let speechCapability: Promise<boolean> | null = null;
function speechAvailable(): Promise<boolean> {
  // Only a successful answer is cached. Errors (offline, 429, expired
  // session) propagate so the user sees the real reason, never a false
  // "voice is disabled".
  speechCapability ??= api("/voice/capabilities", Capability)
    .then((c) => c.speech)
    .catch((error: unknown) => {
      speechCapability = null;
      throw error;
    });
  return speechCapability;
}
const SPEECH_DISABLED =
  "القراءة بالصوت مش مفعّلة على الخادم ده. لتفعيلها: ضيف ENABLE_VOICE=true في ملف ‎.env‎ وأعد تشغيل الخادم.";
function speechError(e: unknown): string {
  if (e instanceof ApiFailure)
    return e.code === "DISCONNECTED"
      ? SPEECH_DISABLED
      : e.code === "PROVIDER_QUOTA" || e.code === "RATE_LIMITED"
        ? "خدمة الصوت وصلت لحد الاستخدام دلوقتي. النص موجود؛ جرّب بعد شوية."
        : e.code === "PROVIDER_AUTH"
          ? "مفتاح خدمة الصوت مرفوض. راجع GEMINI_API_KEY ونموذج GEMINI_TTS_MODEL."
          : e.code === "PROVIDER_TIMEOUT"
            ? "تجهيز الصوت أخد وقت أطول من المسموح. جرّب تاني."
            : e.code === "NETWORK"
              ? e.message
              : "خدمة الصوت ما ردّتش. النص موجود؛ جرّب تاني.";
  return "تعذّر تشغيل الصوت. النص موجود؛ جرّب تاني.";
}
export function SpeechButton({ text }: { text: string }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "playing" | "paused">(
      "idle",
    ),
    [error, setError] = useState("");
  useVoiceSignal("speech", phase === "paused" ? "idle" : phase);
  const player = useRef<HTMLAudioElement | null>(null),
    request = useRef<AbortController | null>(null),
    url = useRef("");
  const stop = useCallback(() => {
    request.current?.abort();
    player.current?.pause();
    player.current = null;
    setPhase("idle");
  }, []);
  useEffect(() => {
    window.addEventListener(STOP_VOICE_OUTPUT, stop);
    return () => {
      window.removeEventListener(STOP_VOICE_OUTPUT, stop);
      request.current?.abort();
      player.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, [stop]);
  async function speak() {
    if (phase === "loading") return; // no duplicate requests
    setError("");
    let available: boolean;
    try {
      available = await speechAvailable();
    } catch (e) {
      setError(speechError(e));
      return;
    }
    if (!available) {
      setError(SPEECH_DISABLED);
      return;
    }
    // Starting a new output or recording interrupts the previous speaker.
    window.dispatchEvent(new Event(STOP_VOICE_OUTPUT));
    setPhase("loading");
    const active = new AbortController();
    request.current = active;
    try {
      // Replay reuses the audio already generated in this session.
      if (!url.current) {
        const payload = JSON.stringify({
          text: speechText(text),
          language: /[؀-ۿ]/u.test(text) ? "ar" : "en",
          consent: true,
        });
        const call = () =>
          fetch("/api/v1/voice/speak", {
            method: "POST",
            headers: headers(),
            body: payload,
            signal: active.signal,
          });
        const errorCode = async (r: Response) => {
          const body = z
            .object({ error: z.string() })
            .safeParse(await r.json().catch(() => null));
          return body.success ? body.data.error : "UNAVAILABLE";
        };
        let response = await call();
        // One bounded retry, only for a transient upstream failure (not for
        // quota, auth, timeout or invalid input).
        if (
          (response.status === 502 || response.status === 503) &&
          (await errorCode(response.clone())) === "PROVIDER_UNAVAILABLE"
        )
          response = await call();
        if (!response.ok)
          throw new ApiFailure(response.status, await errorCode(response));
        const blob = await response.blob();
        if (active.signal.aborted || request.current !== active) return;
        if (!blob.size || !blob.type.startsWith("audio/"))
          throw new ApiFailure(502, "UNAVAILABLE");
        url.current = URL.createObjectURL(blob);
      }
      const audio = new Audio(url.current);
      player.current = audio;
      audio.onended = stop;
      audio.onerror = () => {
        stop();
        setError("المتصفح ما قدرش يشغّل ملف الصوت. النص موجود.");
      };
      await audio.play();
      if (active.signal.aborted || request.current !== active) {
        audio.pause();
        return;
      }
      setPhase("playing");
    } catch (e) {
      if (request.current !== active) return;
      if (!active.signal.aborted)
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "المتصفح منع التشغيل التلقائي. اضغط «استمع» تاني."
            : speechError(e),
        );
      stop();
    }
  }
  function togglePause() {
    const audio = player.current;
    if (!audio) return;
    if (phase === "playing") {
      audio.pause();
      setPhase("paused");
    } else if (phase === "paused") {
      void audio.play().then(
        () => setPhase("playing"),
        () => stop(),
      );
    }
  }
  return (
    <span className="speech-control" data-phase={phase}>
      {phase === "idle" || phase === "loading" ? (
        <button
          type="button"
          onClick={() => void speak()}
          aria-busy={phase === "loading"}
          aria-label={phase === "loading" ? "جارٍ تجهيز الصوت" : "استمع للرد"}
        >
          {phase === "loading" ? "تجهيز الصوت…" : "استمع ◖"}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={togglePause}
            aria-label={phase === "playing" ? "إيقاف مؤقت" : "متابعة الاستماع"}
          >
            {phase === "playing" ? "إيقاف مؤقت ❚❚" : "متابعة ▶"}
          </button>
          <button type="button" onClick={stop} aria-label="إيقاف الصوت">
            إيقاف ■
          </button>
        </>
      )}
      {error && (
        <span role="status" className="speech-error">
          {error}
        </span>
      )}
    </span>
  );
}
