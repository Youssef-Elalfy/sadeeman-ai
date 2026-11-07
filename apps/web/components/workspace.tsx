"use client";
import { AgentEvent, TravelState } from "@sadeeman/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  ApiFailure,
  api,
  History,
  Id,
  Message,
  SessionGrant,
  saveToken,
  sessionExpired,
  streamEvents,
  token,
} from "../lib/api";
import { deriveTitle, readTitles, rememberTitle } from "../lib/titles";
import { CinematicBackground } from "./cinematic-background";
import { RichText } from "./rich-text";
import { SettingsDialog, type SettingsTab } from "./settings-dialog";
import { TravelResults } from "./travel-results";
import { SpeechButton, VoicePanel } from "./voice-panel";

const Health = z.object({
  persistence: z.string(),
  dataMode: z.string(),
  model: z.string(),
  voice: z.boolean().optional(),
  research: z.string().optional(),
});
/** Old deep links (#/settings, #/profile, #/memory) open the settings dialog. */
const legacyRoutes: Record<string, SettingsTab> = {
  settings: "general",
  profile: "account",
  memory: "privacy",
};
const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: preference simply isn't remembered */
    }
  },
};
const Source = z.object({
  url: z.url(),
  title: z.string(),
  retrievedAt: z.string(),
  publicationEstimateAt: z.string().nullable(),
});
type Msg = z.infer<typeof Message> & { id: string };
export function Workspace() {
  const [health, setHealth] = useState<z.infer<typeof Health> | null>(null),
    [authenticated, setAuthenticated] = useState(false),
    [settings, setSettings] = useState<SettingsTab | null>(null),
    [history, setHistory] = useState<z.infer<typeof History>>([]),
    [conversation, setConversation] = useState(""),
    [messages, setMessages] = useState<Msg[]>([]),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [activity, setActivity] = useState(""),
    [voice, setVoice] = useState(false),
    [titles, setTitles] = useState<Record<string, string>>({}),
    [attachment, setAttachment] = useState<{
      name: string;
      size: number;
      mime: string;
      /** TXT/MD: inlined into the message text. */
      text?: string;
      /** Image/PDF: real bytes for the vision-capable model. */
      dataBase64?: string;
      preview?: string;
    } | null>(null),
    [menu, setMenu] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [drawerMode, setDrawerMode] = useState(false),
    [search, setSearch] = useState(""),
    [theme, setTheme] = useState("dark"),
    [reduced, setReduced] = useState(false),
    [locale, setLocale] = useState<"ar-EG" | "en">("ar-EG"),
    [trip, setTrip] = useState<z.infer<typeof TravelState> | null>(null),
    [sources, setSources] = useState<z.infer<typeof Source>[]>([]),
    [sourceView, setSourceView] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false);
  const [artifacts, setArtifacts] = useState<{ tool: string; data: unknown }[]>(
    [],
  );
  const request = useRef<AbortController | null>(null),
    runId = useRef(""),
    bottom = useRef<HTMLDivElement>(null);
  const reloadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await api("/conversations", History));
    } finally {
      setHistoryLoading(false);
    }
  }, []);
  const establish = useCallback(async () => {
    // Verifies the stored token; the account id is never shown to users.
    await api("/auth/session", z.object({ ownerId: z.uuid() }));
    setAuthenticated(true);
    await reloadHistory();
  }, [reloadHistory]);
  const loadHealth = useCallback(
    async (signal?: AbortSignal) => {
      setError("");
      try {
        const h = await api("/health", Health, "GET", undefined, signal);
        setHealth(h);
        if (token())
          await establish().catch((e: unknown) => {
            // Only a definitive auth rejection ends the session; a 429 or a
            // network blip must not log the user out.
            if (e instanceof ApiFailure && e.status === 401) saveToken("");
            setAuthenticated(false);
          });
      } catch (e) {
        if (signal?.aborted) return;
        if (e instanceof ApiFailure && e.status > 0 && e.code !== "NETWORK") {
          setError(e.message);
          return;
        }
        setHealth(null);
        setError("الخادم المحلي مش متصل. شغّل خدمة SADEEMAN وحاول تاني.");
      }
    },
    [establish],
  );
  useEffect(() => {
    const a = new AbortController();
    void loadHealth(a.signal);
    setTitles(readTitles());
    const saved = storage.get("sadeeman.theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
    const savedMotion = storage.get("sadeeman.reducedMotion");
    setReduced(
      savedMotion === null
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : savedMotion === "true",
    );
    const savedLocale = storage.get("sadeeman.locale");
    if (savedLocale === "en" || savedLocale === "ar-EG") setLocale(savedLocale);
    const onHash = () => {
      const wanted = window.location.hash.replace(/^#\/?/, "");
      if (!wanted) return;
      // In-page anchors (skip link #main) are not routes.
      if (document.getElementById(wanted)) return;
      const tab = legacyRoutes[wanted];
      if (tab) setSettings(tab);
      // Retired or unknown routes (e.g. #/crm) simply land on the chat.
      window.history.replaceState(null, "", window.location.pathname);
    };
    onHash();
    const onExpired = () => {
      saveToken("");
      setAuthenticated(false);
      setHistory([]);
      setConversation("");
      setMessages([]);
      setTrip(null);
      setSources([]);
      setArtifacts([]);
      setError("الجلسة انتهت. ابدأ جلسة جديدة أو سجّل دخولك تاني.");
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener(sessionExpired, onExpired);
    return () => {
      a.abort();
      request.current?.abort();
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener(sessionExpired, onExpired);
    };
  }, [loadHealth]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.conversationLocale = locale;
  }, [locale]);
  // Preferences are stored only when the user changes them, never from an
  // effect: StrictMode re-runs would otherwise overwrite saved values with
  // defaults, and the OS reduced-motion setting would be frozen as a choice.
  function chooseTheme(next: "dark" | "light") {
    setTheme(next);
    storage.set("sadeeman.theme", next);
  }
  function chooseLocale(next: "ar-EG" | "en") {
    setLocale(next);
    storage.set("sadeeman.locale", next);
  }
  function chooseReduced(next: boolean) {
    setReduced(next);
    storage.set("sadeeman.reducedMotion", String(next));
  }
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      setDrawerMode(query.matches);
      if (!query.matches) setMenu(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!menu) return;
    document.querySelector<HTMLButtonElement>(".sidebar .new-chat")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false);
      // After the re-render removes "inert" from the page.
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus(),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  useEffect(() => {
    document.title = authenticated
      ? "المحادثة · سَدِيمًا | SADEEMAN AI"
      : "ابدأ · سَدِيمًا | SADEEMAN AI";
  }, [authenticated]);
  function resetConversationView() {
    setMessages([]);
    setTrip(null);
    setSources([]);
    setSourceView(false);
    setArtifacts([]);
  }
  useEffect(() => {
    if (!messages.length && !busy) return;
    bottom.current?.scrollIntoView({
      behavior: reduced ? "instant" : "smooth",
      block: "nearest",
    });
  }, [messages.length, busy, reduced]);
  async function guarded(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? "راجع البيانات المطلوبة وحاول تاني."
          : e instanceof Error
            ? e.message
            : "حصل خطأ؛ حاول تاني.",
      );
    }
  }
  function focusComposer() {
    requestAnimationFrame(() => document.getElementById("message")?.focus());
  }
  /**
   * Chat is available immediately. A guest session is created only when the
   * first message is sent (never on page load) and is reused from session
   * storage across refreshes. Sending implies the public-data notice shown
   * next to the composer.
   */
  async function ensureSession() {
    if (authenticated && token()) return;
    const session = await api(
      "/auth/guest",
      SessionGrant,
      "POST",
      health?.dataMode === "synthetic_only"
        ? { acceptSyntheticDataPolicy: true }
        : { acceptPublicDataPolicy: true },
    );
    saveToken(session.token, session.refreshToken ?? "");
    await establish();
  }
  /** Optional email sign-in for existing accounts. Returns an error or "". */
  async function login(email: string, password: string): Promise<string> {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "اكتب بريد إلكتروني صحيح.";
    if (!password) return "اكتب كلمة المرور.";
    try {
      const result = await api("/auth/login", SessionGrant, "POST", {
        email: email.trim(),
        password,
      });
      saveToken(result.token, result.refreshToken ?? "");
      resetConversationView();
      setConversation("");
      await establish();
      setSettings(null);
      focusComposer();
      return "";
    } catch (e) {
      return e instanceof ApiFailure && e.status === 401
        ? "البريد أو كلمة المرور غير صحيحين."
        : e instanceof Error
          ? e.message
          : "تعذّر تسجيل الدخول؛ حاول تاني.";
    }
  }
  async function newConversation() {
    if (busy) return;
    if (!authenticated) {
      setMenu(false);
      focusComposer();
      return;
    }
    if (conversation && !messages.length) {
      setMenu(false);
      focusComposer();
      return;
    }
    await guarded(async () => {
      const c = await api("/conversations", Id, "POST", {});
      setConversation(c.id);
      resetConversationView();
      setMenu(false);
      await reloadHistory();
      focusComposer();
    });
  }
  async function openConversation(id: string) {
    if (busy) return;
    await guarded(async () => {
      const c = await api(
        `/conversations/${id}`,
        z.object({
          messages: z.array(Message),
          travelState: TravelState.nullable().optional(),
        }),
      );
      setConversation(id);
      resetConversationView();
      setMessages(c.messages.map((m) => ({ ...m, id: crypto.randomUUID() })));
      // Older conversations: derive the title from their real first message.
      const first = c.messages.find((m) => m.role === "user")?.content;
      if (first) setTitles(rememberTitle(id, deriveTitle(first)));
      setTrip(c.travelState ?? null);
      setMenu(false);
    });
  }
  async function send(override?: string) {
    const draft = override ?? input;
    if ((!draft.trim() && !attachment) || busy) return;
    setError("");
    setBusy(true);
    setActivity("بنفهم طلبك…");
    const file = attachment;
    const content =
      file?.text !== undefined
        ? `${draft.trim()}\n\n[ملف مرفق: ${file.name}]\n${file.text}`.slice(
            0,
            16000,
          )
        : file
          ? `${draft.trim() || "اشرحلي المرفق ده."}\n\n[مرفق: ${file.name}]`
          : draft;
    if (file?.preview) URL.revokeObjectURL(file.preview);
    setInput("");
    setAttachment(null);
    const ctl = new AbortController();
    request.current = ctl;
    let active = conversation;
    // Optimistic bubble; removed again if the turn is not durably completed,
    // because the API only commits the user turn together with the answer.
    const userMessageId = crypto.randomUUID();
    const dropUnsent = () =>
      setMessages((m) => m.filter((message) => message.id !== userMessageId));
    try {
      if (!authenticated) {
        await ensureSession();
        active = "";
      }
      if (!active) {
        const c = await api("/conversations", Id, "POST", {});
        active = c.id;
        setConversation(c.id);
      }
      // Title from the FIRST message only; never rewritten later.
      if (!messages.length)
        setTitles(
          rememberTitle(active, deriveTitle(draft || attachment?.name || "")),
        );
      setMessages((m) => [...m, { role: "user", content, id: userMessageId }]);
      const accepted = await api(
        "/agent/messages",
        z.object({ runId: z.uuid() }),
        "POST",
        {
          conversationId: active,
          content,
          locale,
          clientRequestId: crypto.randomUUID(),
          ...(file?.dataBase64
            ? {
                attachments: [
                  {
                    name: file.name,
                    mime: file.mime,
                    dataBase64: file.dataBase64,
                  },
                ],
              }
            : {}),
        },
        ctl.signal,
      );
      runId.current = accepted.runId;
      let completed = false;
      await streamEvents(
        accepted.runId,
        (raw) => {
          const e = AgentEvent.parse(raw);
          if (e.type === "tool_started") {
            setActivity(
              e.toolName?.includes("research")
                ? "بنراجع مصادر السفر…"
                : "بنرتب تفاصيل الرحلة…",
            );
          }
          if (e.type === "model_processing") {
            setActivity("بنحضّر الرد…");
          }
          if (e.type === "response_completed") {
            completed = true;
            setMessages((m) => [
              ...m,
              {
                role: "assistant",
                content: e.textDelta ?? "",
                id: crypto.randomUUID(),
              },
            ]);
          }
          if (e.type === "run_failed" || e.type === "run_canceled") {
            setError(
              e.textDelta ??
                "الطلب ما اكتملش. تفاصيلك المؤكدة زي ما هي؛ تقدر تحاول تاني.",
            );
          }
        },
        ctl.signal,
      );
      const snapshot = await api(
        `/agent/runs/${accepted.runId}`,
        z.object({
          travelContext: z
            .object({ proposed: TravelState, committed: z.boolean() })
            .nullable(),
          sourceEvidence: z.array(Source),
          travelArtifacts: z.array(
            z.object({ tool: z.string(), data: z.unknown() }),
          ),
        }),
      );
      if (snapshot.travelContext?.committed)
        setTrip(snapshot.travelContext.proposed);
      setSources(snapshot.sourceEvidence);
      setArtifacts(snapshot.travelArtifacts);
      if (!completed) {
        dropUnsent();
        setInput(content);
      }
    } catch (e) {
      dropUnsent();
      if (!ctl.signal.aborted) {
        // Only mapped, customer-safe messages; never raw parser/fetch text.
        setError(
          e instanceof ApiFailure
            ? e.code === "DISCONNECTED"
              ? "المحادثة الذكية مش مفعّلة على الخادم ده (مفيش مزوّد نموذج مفعّل). رسالتك لسه في الخانة؛ ما اتبعتتش."
              : e.message
            : "الرد ما اكتملش. تفاصيلك المؤكدة زي ما هي، ورسالتك لسه في الخانة؛ حاول تاني.",
        );
        setInput(content);
      }
    } finally {
      void reloadHistory().catch(() => undefined);
      // A cancelled run must not clear the state of a newer run.
      if (request.current === ctl) {
        setBusy(false);
        setActivity("");
        runId.current = "";
      }
    }
  }
  async function cancel() {
    const id = runId.current;
    request.current?.abort();
    if (id)
      await guarded(async () => {
        await api(
          `/agent/runs/${id}`,
          z.object({ status: z.string() }),
          "DELETE",
        );
      });
    setBusy(false);
    setActivity("");
  }
  const c = trip?.constraints;
  const money = (minor: number, currency: string) =>
    new Intl.NumberFormat("ar-EG", { style: "currency", currency }).format(
      minor /
        10 **
          (new Intl.NumberFormat("en", {
            style: "currency",
            currency,
          }).resolvedOptions().maximumFractionDigits ?? 2),
    );
  const tripFacts: [string, string][] = c
    ? [
        ...(c.destination
          ? [["الوجهة", c.destination] as [string, string]]
          : []),
        ...(c.days ? [["المدة", `${c.days} أيام`] as [string, string]] : []),
        ...(c.travellers
          ? [["المسافرون", String(c.travellers)] as [string, string]]
          : []),
        ...(c.budgetMinor !== undefined && c.currency
          ? [
              ["الميزانية", money(c.budgetMinor, c.currency)] as [
                string,
                string,
              ],
            ]
          : []),
        ...(c.adults !== undefined
          ? [["البالغون", String(c.adults)] as [string, string]]
          : []),
        ...(c.children !== undefined
          ? [["الأطفال", String(c.children)] as [string, string]]
          : []),
        ...(c.startsOn ? [["البداية", c.startsOn] as [string, string]] : []),
        ...(c.endsOn ? [["النهاية", c.endsOn] as [string, string]] : []),
        ...(c.budgetIncludesFlights !== undefined
          ? [
              ["الطيران", c.budgetIncludesFlights ? "شامل" : "مش شامل"] as [
                string,
                string,
              ],
            ]
          : []),
      ]
    : [];
  const service = !health
    ? { tone: "down", text: "الخادم غير متصل" }
    : health.model === "disconnected"
      ? { tone: "warn", text: "المحادثة الذكية غير مفعّلة" }
      : { tone: "ok", text: "جاهز" };
  const query = search.trim();
  const historyMatches = history
    .map((h, i) => ({ ...h, number: history.length - i }))
    .filter(
      (h) =>
        !query ||
        String(h.number).includes(query) ||
        (titles[h.id] ?? "").includes(query) ||
        new Date(h.createdAt).toLocaleDateString("ar-EG").includes(query) ||
        new Date(h.createdAt).toLocaleDateString("en-GB").includes(query),
    );
  const loginAvailable = health?.persistence === "supabase";
  const signOut = () =>
    void guarded(async () => {
      if (health?.persistence !== "ephemeral")
        await api("/auth/session", z.unknown(), "DELETE");
      saveToken("");
      setAuthenticated(false);
      resetConversationView();
      setHistory([]);
      setConversation("");
      setSettings(null);
    });
  const currentTitle = (conversation && titles[conversation]) || "محادثة جديدة";
  return (
    <div
      className={`workspace ${reduced ? "reduced-motion" : ""} ${collapsed ? "collapsed" : ""}`}
    >
      <a href="#main" className="skip-link">
        تخطّي للمحتوى الرئيسي
      </a>
      <CinematicBackground reducedMotion={reduced} />
      <aside
        id="sidebar"
        className={`sidebar ${menu ? "open" : ""}`}
        aria-label="المحادثات"
      >
        <div className="sidebar-top">
          <span className="brand">
            <span className="brand-symbol" aria-hidden="true">
              ✦
            </span>
            <span>
              سَدِيمًا<small>SADEEMAN AI</small>
            </span>
          </span>
          <button
            type="button"
            className="new-chat"
            disabled={busy || !authenticated}
            onClick={() => void newConversation()}
          >
            <span aria-hidden="true">＋</span> محادثة جديدة
          </button>
        </div>
        <div className="history">
          <div className="history-heading">
            <h2 id="history-title">محادثاتك السابقة</h2>
            {history.length > 0 && <small>{history.length}</small>}
          </div>
          {history.length > 5 && (
            <input
              className="history-search"
              type="search"
              aria-label="ابحث في المحادثات بالتاريخ أو الرقم"
              placeholder="ابحث…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <ul className="history-list" aria-labelledby="history-title">
            {historyMatches.map((h) => (
              <li key={h.id} className="history-item">
                <button
                  type="button"
                  className={`history-open ${conversation === h.id ? "active" : ""}`}
                  aria-current={conversation === h.id ? "true" : undefined}
                  disabled={busy}
                  onClick={() => void openConversation(h.id)}
                >
                  <span className="history-name" title={titles[h.id]}>
                    {titles[h.id] ?? "محادثة بدون عنوان"}
                  </span>

                  <span className="history-date">
                    {new Date(h.createdAt).toLocaleDateString("ar-EG", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </button>

                <button
                  type="button"
                  className="history-delete"
                  aria-label={`حذف ${titles[h.id] ?? "المحادثة"}`}
                  title="حذف المحادثة"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm("متأكد إنك عايز تحذف المحادثة دي نهائيًا؟")
                    ) {
                      return;
                    }

                    void guarded(async () => {
                      await api(
                        `/conversations/${h.id}`,
                        z.object({ deleted: z.literal(true) }),
                        "DELETE",
                      );

                      if (conversation === h.id) {
                        setConversation("");
                        resetConversationView();
                      }

                      await reloadHistory();
                    });
                  }}
                >
                  حذف
                </button>
              </li>
            ))}
          </ul>
          {authenticated && history.length > 0 && !historyMatches.length && (
            <p className="history-empty">مفيش محادثات مطابقة.</p>
          )}
          {authenticated && !history.length && !historyLoading && (
            <p className="history-empty">محادثاتك هتظهر هنا.</p>
          )}
          {!authenticated && (
            <p className="history-empty">ابدأ جلسة وهتلاقي محادثاتك هنا.</p>
          )}
        </div>
        <button
          type="button"
          className="account-button"
          onClick={() => {
            setMenu(false);
            setSettings("general");
          }}
        >
          <span className="avatar" aria-hidden="true">
            س
          </span>
          <span>
            الإعدادات
            <small>
              {authenticated ? "الحساب والخصوصية" : "ضيف · الدخول اختياري"}
            </small>
          </span>
        </button>
      </aside>
      {menu && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="إغلاق القائمة"
          onClick={() => {
            setMenu(false);
            // After the re-render removes "inert" from the page.
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLButtonElement>(".mobile-menu")
                ?.focus(),
            );
          }}
        />
      )}
      <div className="workspace-main" inert={menu || undefined}>
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu icon-button"
            onClick={() => {
              // Drawer on phones/tablets; collapsible sidebar on desktop.
              if (drawerMode) setMenu((v) => !v);
              else setCollapsed((v) => !v);
            }}
            aria-expanded={drawerMode ? menu : !collapsed}
            aria-controls="sidebar"
            aria-label={menu ? "إغلاق القائمة" : "القائمة والمحادثات"}
          >
            ☰
          </button>
          <h1 className="topbar-title">
            {authenticated ? currentTitle : "سَدِيمًا"}
          </h1>
          {service.tone !== "ok" && (
            <span className={`service-chip ${service.tone}`} role="status">
              <span className="status-dot" aria-hidden="true" />
              <span className="chip-text">{service.text}</span>
            </span>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={
              theme === "dark"
                ? "التبديل للمظهر الفاتح"
                : "التبديل للمظهر الداكن"
            }
            onClick={() => chooseTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☼" : "☾"}
          </button>
        </header>
        <main id="main" tabIndex={-1}>
          {error && (
            <div role="alert" className="alert global-error">
              <span className="alert-icon" aria-hidden="true">
                !
              </span>
              <p>{error}</p>
              <button
                type="button"
                aria-label="إغلاق التنبيه"
                onClick={() => setError("")}
              >
                ×
              </button>
            </div>
          )}
          {
            <section className="chat-column" aria-label="المحادثة">
              {(tripFacts.length > 0 ||
                sources.length > 0 ||
                (conversation && messages.length > 0)) && (
                <div className="chat-toolbar">
                  {tripFacts.length > 0 && (
                    <ul
                      className="trip-chips"
                      aria-label="تفاصيل الرحلة المؤكدة"
                    >
                      {tripFacts.slice(0, 5).map(([label, value]) => (
                        <li key={label}>
                          <small>{label}</small> {value}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="chat-tools">
                    {sources.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={sourceView}
                        onClick={() => setSourceView((v) => !v)}
                      >
                        المصادر ({sources.length})
                      </button>
                    )}
                  </div>
                  {sourceView && sources.length > 0 && (
                    <div className="source-list">
                      {sources.map((s) => (
                        <a
                          className="source-card"
                          key={s.url}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <strong>{s.title}</strong>
                          <small>
                            تم الاطلاع{" "}
                            {new Date(s.retrievedAt).toLocaleDateString(
                              "ar-EG",
                            )}
                          </small>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="chat-scroll">
                {!messages.length ? (
                  <div className="welcome">
                    <h2 className="welcome-title">
                      أهلًا، أنا <em>سَدِيمًا</em>. اسألني في أي حاجة.
                    </h2>
                    <p className="welcome-lede">
                      بجاوب بالمصري والإنجليزي، وبخطط رحلاتك بمصادر حقيقية.
                    </p>
                    <ul className="suggestions" aria-label="اقتراحات للبداية">
                      {(
                        [
                          [
                            "✧",
                            "رحلة لتركيا",
                            "عايز أسافر تركيا 5 أيام، إحنا شخصين وميزانيتنا 30 ألف جنيه.",
                          ],
                          [
                            "◈",
                            "وجهة هادية في مصر",
                            "رشحلي وجهة في مصر فيها طبيعة وهدوء.",
                          ],
                          [
                            "✦",
                            "يعني إيه ذكاء اصطناعي؟",
                            "اشرحلي يعني إيه الذكاء الاصطناعي ببساطة.",
                          ],
                          [
                            "⌁",
                            "أتعلم إنجليزي",
                            "ساعدني أتعلم إنجليزي من الصفر.",
                          ],
                        ] as const
                      ).map(([icon, title, text]) => (
                        <li key={title}>
                          <button
                            type="button"
                            onClick={() => {
                              setInput(text);
                              focusComposer();
                            }}
                          >
                            <span aria-hidden="true">{icon}</span>
                            {title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div
                    className="messages"
                    aria-live="polite"
                    aria-relevant="additions"
                  >
                    {messages.map((m) => (
                      <article className={`message ${m.role}`} key={m.id}>
                        <span className="message-avatar" aria-hidden="true">
                          {m.role === "assistant" ? "✦" : "أنت"}
                        </span>
                        <div className="message-body">
                          <div className="message-label">
                            {m.role === "assistant" ? "سَدِيمًا" : "أنت"}
                          </div>
                          <RichText text={m.content} />
                          {m.role === "assistant" && (
                            <SpeechButton text={m.content} />
                          )}
                        </div>
                      </article>
                    ))}
                    {artifacts.length > 0 && (
                      <TravelResults artifacts={artifacts} />
                    )}
                  </div>
                )}
                {busy && (
                  <p role="status" className="activity">
                    <span className="status-dot" />
                    {activity}
                  </p>
                )}
                <div ref={bottom} />
              </div>
              <div className="composer-wrap">
                {attachment && (
                  <div className="attachment-chip">
                    {attachment.preview ? (
                      // biome-ignore lint/performance/noImgElement: local object-URL thumbnail of the user's own file.
                      <img
                        className="attachment-thumb"
                        src={attachment.preview}
                        alt=""
                      />
                    ) : (
                      <span aria-hidden="true">
                        {attachment.mime === "application/pdf" ? "📄" : "📎"}
                      </span>
                    )}
                    <span className="attachment-name">{attachment.name}</span>
                    <small>
                      {Math.max(1, Math.round(attachment.size / 1024))} KB
                    </small>
                    <button
                      type="button"
                      aria-label={`إزالة المرفق ${attachment.name}`}
                      onClick={() => {
                        if (attachment.preview)
                          URL.revokeObjectURL(attachment.preview);
                        setAttachment(null);
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <label className="sr-only" htmlFor="message">
                    رسالتك لسَدِيمًا
                  </label>
                  <textarea
                    id="message"
                    rows={1}
                    maxLength={16000}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      const t = e.currentTarget;
                      t.style.height = "auto";
                      t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
                    }}
                    placeholder="اكتب رسالتك…"
                    disabled={busy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <label
                    className={`icon-button attach ${busy ? "disabled" : ""}`}
                    aria-label="إرفاق صورة أو ملف"
                    title="إرفاق صورة (PNG/JPG/WEBP) أو ملف (PDF/TXT/MD)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      height="23"
                      width="23"
                      stroke="currentColor"
                      fill="none"
                      strokeLinecap="round"
                      strokeWidth={2}
                      aria-hidden="true"
                      strokeLinejoin="round"
                    >
                      <path d="m16.5 6.5-7.79 7.79a3 3 0 0 0 4.24 4.24l8.49-8.49a5 5 0 0 0-7.07-7.07l-8.49 8.49a7 7 0 0 0 9.9 9.9l7.78-7.78" />
                    </svg>
                    <input
                      type="file"
                      className="sr-only"
                      disabled={busy}
                      accept=".txt,.md,text/plain,text/markdown,image/png,image/jpeg,image/webp,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        const isText =
                          /\.(txt|md)$/i.test(file.name) ||
                          ["text/plain", "text/markdown"].includes(file.type);
                        const binary = [
                          "image/png",
                          "image/jpeg",
                          "image/webp",
                          "application/pdf",
                        ].includes(file.type);
                        if (!isText && !binary) {
                          setError(
                            "نوع الملف ده مش مدعوم. المدعوم: صور PNG وJPG وWEBP، وملفات PDF وTXT وMD.",
                          );
                          return;
                        }
                        if (isText) {
                          if (file.size > 50000) {
                            setError(
                              "الملف النصي أكبر من 50 كيلوبايت؛ اختصره.",
                            );
                            return;
                          }
                          void file.text().then((text) => {
                            if (text.includes("\u0000")) {
                              setError("الملف ده مش نص صالح.");
                              return;
                            }
                            setAttachment({
                              name: file.name,
                              size: file.size,
                              mime: "text/plain",
                              text,
                            });
                            focusComposer();
                          });
                          return;
                        }
                        if (file.size > 4000000) {
                          setError(
                            "الحد الأقصى للصورة أو الـPDF هو 4 ميجابايت.",
                          );
                          return;
                        }
                        const reader = new FileReader();
                        reader.onerror = () => setError("تعذّر قراءة الملف.");
                        reader.onload = () => {
                          const data =
                            String(reader.result).split(",")[1] ?? "";
                          if (!data) {
                            setError("تعذّر قراءة الملف.");
                            return;
                          }
                          setAttachment({
                            name: file.name,
                            size: file.size,
                            mime: file.type,
                            dataBase64: data,
                            ...(file.type.startsWith("image/")
                              ? { preview: URL.createObjectURL(file) }
                              : {}),
                          });
                          focusComposer();
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    className={`icon-button mic ${voice ? "selected" : ""}`}
                    aria-label="تسجيل رسالة صوتية"
                    aria-expanded={voice}
                    onClick={() => setVoice((v) => !v)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="23"
                      height="23"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                      <path d="M12 19v3M8 22h8" />
                    </svg>
                  </button>
                  {busy ? (
                    <button
                      type="button"
                      className="send"
                      aria-label="إيقاف الرد"
                      onClick={() => void cancel()}
                    >
                      ■
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="send"
                      disabled={!input.trim() && !attachment}
                      aria-label="إرسال الرسالة"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="23"
                        height="23"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 19V5" />
                        <path d="m5 12 7-7 7 7" />
                      </svg>
                    </button>
                  )}
                </form>
                {voice && (
                  <VoicePanel
                    language={locale === "en" ? "en" : "ar"}
                    onClose={() => {
                      setVoice(false);
                      focusComposer();
                    }}
                    onTranscript={setInput}
                    onSend={(text) => void send(text)}
                  />
                )}
                <p className="composer-note">
                  {health?.model === "disconnected"
                    ? "المحادثة الذكية مش مفعّلة على الخادم ده."
                    : authenticated
                      ? "سَدِيمًا بيقولك لما مش متأكد. مفيش حجز أو دفع."
                      : "بإرسال رسالتك بتوافق إنك تستخدم بيانات عامة وغير حساسة بس. مفيش حجز أو دفع."}{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer">
                    الخصوصية ومعالجة البيانات
                  </a>
                </p>
              </div>
            </section>
          }
        </main>
      </div>
      <SettingsDialog
        tab={settings}
        onTab={setSettings}
        onClose={() => setSettings(null)}
        theme={theme === "light" ? "light" : "dark"}
        onTheme={chooseTheme}
        locale={locale}
        onLocale={chooseLocale}
        reduced={reduced}
        onReduced={chooseReduced}
        authenticated={authenticated}
        persistent={health?.persistence !== "ephemeral"}
        conversationId={conversation}
        loginAvailable={loginAvailable}
        onLogin={login}
        onSignOut={signOut}
      />
    </div>
  );
}
