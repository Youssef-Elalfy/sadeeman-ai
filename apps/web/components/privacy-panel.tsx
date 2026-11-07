"use client";
import { StoredMemory } from "@sadeeman/contracts";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { api, consentKey } from "../lib/api";
export function PrivacyPanel({ conversationId }: { conversationId: string }) {
  const [memories, setMemories] = useState<z.infer<typeof StoredMemory>[]>([]),
    [error, setError] = useState(""),
    [consent, setConsentState] = useState(""),
    [text, setText] = useState(""),
    [category, setCategory] = useState("travel_style");
  // The consent record lives on the server; remember its id for this tab so
  // the user is not asked again on every visit (cleared on logout).
  useEffect(() => {
    try {
      setConsentState(sessionStorage.getItem(consentKey) ?? "");
    } catch {
      /* storage unavailable: consent is simply requested again */
    }
  }, []);
  function setConsent(id: string) {
    setConsentState(id);
    try {
      if (id) sessionStorage.setItem(consentKey, id);
      else sessionStorage.removeItem(consentKey);
    } catch {
      /* ignore */
    }
  }
  const load = useCallback(async () => {
    try {
      setMemories(await api("/memory", z.array(StoredMemory)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "الذاكرة غير متاحة.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحديث الذاكرة.");
    }
  }
  return (
    <div className="privacy-panel">
      <p className="muted">
        تفضيلات السفر اختيارية. محادثاتك ما بتتحولش لذاكرة طويلة تلقائيًا، وتقدر
        تعدّل أو تمسح في أي وقت.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="surface">
        <h3>موافقة الذاكرة</h3>
        <p>
          احفظ تفضيلات سفر غير حساسة لمدة محددة. لا تحفظ أرقام جوازات أو بيانات
          دفع أو معلومات طبية.
        </p>
        <p className="consent-state" role="status">
          {consent
            ? "✓ الموافقة مفعّلة — تقدر تحفظ تفضيلات لمدة 90 يوم."
            : "الموافقة مش مفعّلة. مفيش أي تفضيل بيتحفظ."}
        </p>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={Boolean(consent)}
            onClick={() =>
              void act(async () => {
                const r = await api(
                  "/consents",
                  z.object({ id: z.uuid() }),
                  "POST",
                  {
                    purpose: "travel_preferences",
                    accepted: true,
                    version: "memory-v1",
                    requestId: crypto.randomUUID(),
                  },
                );
                setConsent(r.id);
              })
            }
          >
            أوافق على ذاكرة تفضيلات السفر
          </button>
          <button
            type="button"
            disabled={!consent && !memories.length}
            onClick={() => {
              if (
                !window.confirm(
                  "إيقاف الذاكرة هيمسح كل التفضيلات المحفوظة نهائيًا. متأكد؟",
                )
              )
                return;
              void act(async () => {
                await api("/consents", z.object({ id: z.uuid() }), "POST", {
                  purpose: "travel_preferences",
                  accepted: false,
                  version: "memory-v1",
                  requestId: crypto.randomUUID(),
                });
                setConsent("");
              });
            }}
          >
            إيقاف الذاكرة ومسح التفضيلات
          </button>
        </div>
      </div>
      <form
        className="surface"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api("/memory", StoredMemory, "POST", {
              consentId: consent,
              sourceConversationId: conversationId,
              category,
              content: text,
              expiresInDays: 90,
              requestId: crypto.randomUUID(),
            });
            setText("");
          });
        }}
      >
        <h3>تفضيل جديد</h3>
        <label htmlFor="memory-category">نوع التفضيل</label>
        <select
          id="memory-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {(
            [
              ["travel_style", "أسلوب السفر"],
              ["destination", "وجهات مفضّلة"],
              ["accessibility", "احتياجات الإتاحة"],
              ["budget", "الميزانية"],
              ["language", "اللغة"],
            ] as const
          ).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="memory-text">اكتب اللي تحب نفتكره</label>
        <textarea
          id="memory-text"
          required
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="muted">
          الحفظ مرتبط بمحادثة: أضف التفضيل من إعدادات رحلتك بعد فتح محادثة،
          وبموافقة فعالة.
        </p>
        <button
          type="submit"
          disabled={!consent || !text.trim() || !conversationId}
        >
          حفظ لمدة 90 يوم
        </button>
      </form>
      <div className="surface">
        <h3>المحفوظ فعلًا</h3>
        {!memories.length && <p className="muted">مفيش تفضيلات محفوظة.</p>}
        {memories.map((m) => (
          <article className="memory" key={m.id}>
            <p>{m.content}</p>
            <small>
              ينتهي {new Date(m.expiresAt).toLocaleDateString("ar-EG")}
            </small>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  const content = window.prompt("عدّل التفضيل", m.content);
                  if (content?.trim())
                    void act(async () => {
                      await api(`/memory/${m.id}`, StoredMemory, "PATCH", {
                        consentId: m.consentId,
                        category: m.category,
                        content,
                        expiresInDays: 90,
                        expectedVersion: m.version,
                        requestId: crypto.randomUUID(),
                      });
                    });
                }}
              >
                تعديل
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  if (!window.confirm("حذف التفضيل ده نهائيًا؟")) return;
                  void act(async () => {
                    await api(
                      `/memory/${m.id}`,
                      z.object({ deleted: z.literal(true) }),
                      "DELETE",
                    );
                  });
                }}
              >
                حذف
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
