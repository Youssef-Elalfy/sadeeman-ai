"use client";
import { useEffect, useRef, useState } from "react";
import { PrivacyPanel } from "./privacy-panel";

export type SettingsTab = "general" | "privacy" | "account";
const tabs: [SettingsTab, string][] = [
  ["general", "عام"],
  ["privacy", "الخصوصية والبيانات"],
  ["account", "الحساب"],
];

/**
 * One compact modal for everything that is not the conversation: appearance,
 * privacy & data (consent, saved preferences, deletion) and the session.
 * Native <dialog> gives a focus trap, Escape-to-close and an inert page.
 */
export function SettingsDialog(props: {
  tab: SettingsTab | null;
  onTab: (tab: SettingsTab) => void;
  onClose: () => void;
  theme: "dark" | "light";
  onTheme: (theme: "dark" | "light") => void;
  locale: "ar-EG" | "en";
  onLocale: (locale: "ar-EG" | "en") => void;
  reduced: boolean;
  onReduced: (reduced: boolean) => void;
  authenticated: boolean;
  persistent: boolean;
  conversationId: string;
  loginAvailable: boolean;
  onLogin: (email: string, password: string) => Promise<string>;
  onSignOut: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = props.tab !== null;
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const active = props.tab ?? "general";
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [loginError, setLoginError] = useState(""),
    [signingIn, setSigningIn] = useState(false);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; keyboard users close with Escape (native dialog) or the close button.
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onClose={props.onClose}
      onClick={(e) => {
        // A click on the backdrop (the dialog box itself, outside the panel) closes.
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="settings-panel">
        <header className="settings-head">
          <h2 id="settings-title">الإعدادات</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="إغلاق الإعدادات"
            onClick={props.onClose}
          >
            ×
          </button>
        </header>
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="أقسام الإعدادات"
        >
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={active === id}
              aria-controls="settings-body"
              tabIndex={active === id ? 0 : -1}
              onClick={() => props.onTab(id)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                e.preventDefault();
                const i = tabs.findIndex(([t]) => t === active);
                // RTL: ArrowLeft moves forward.
                const step = e.key === "ArrowLeft" ? 1 : -1;
                const next = tabs[(i + step + tabs.length) % tabs.length];
                if (!next) return;
                props.onTab(next[0]);
                document.getElementById(`settings-tab-${next[0]}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id="settings-body"
          className="settings-body"
          role="tabpanel"
          aria-labelledby={`settings-tab-${active}`}
        >
          {active === "general" && (
            <div className="settings-form">
              <label htmlFor="theme">المظهر</label>
              <select
                id="theme"
                value={props.theme}
                onChange={(e) =>
                  props.onTheme(e.target.value === "light" ? "light" : "dark")
                }
              >
                <option value="dark">سماء ليلية</option>
                <option value="light">ضوء الصبح</option>
              </select>
              <label htmlFor="locale">لغة الردود والصوت</label>
              <select
                id="locale"
                value={props.locale}
                onChange={(e) =>
                  props.onLocale(e.target.value === "en" ? "en" : "ar-EG")
                }
              >
                <option value="ar-EG">العربية المصرية</option>
                <option value="en">English</option>
              </select>
              <label className="consent-check">
                <input
                  type="checkbox"
                  checked={props.reduced}
                  onChange={(e) => props.onReduced(e.target.checked)}
                />
                تقليل الحركة وإيقاف فيديو الخلفية
              </label>
              <details className="credits">
                <summary>حقوق فيديو الخلفية</summary>
                <ul>
                  <li>
                    تمثال الحرية، برج إيفل، مانهاتن: the Dronalist — CC BY 3.0
                  </li>
                  <li>الكولوسيوم، روما: Quahadi — CC BY 4.0</li>
                </ul>
                <p>
                  مقاطع من Wikimedia Commons، تم قصّها ودمجها.{" "}
                  <a href="/media/CREDITS.md" target="_blank" rel="noopener">
                    التفاصيل والروابط
                  </a>
                </p>
              </details>
            </div>
          )}
          {active === "privacy" &&
            (props.authenticated ? (
              <PrivacyPanel conversationId={props.conversationId} />
            ) : (
              <p className="muted">
                ابدأ جلسة الأول عشان تدير الموافقات والتفضيلات المحفوظة.
              </p>
            ))}
          {active === "account" && (
            <div className="settings-form">
              {props.authenticated ? (
                <>
                  <p>
                    {props.persistent
                      ? "أنت داخل، ومحادثاتك محفوظة في «محادثاتك السابقة»."
                      : "أنت داخل بجلسة مؤقتة؛ المحادثات مش بتتحفظ بعد إعادة تشغيل الخادم."}
                  </p>
                  <button
                    type="button"
                    className="danger"
                    onClick={props.onSignOut}
                  >
                    تسجيل الخروج
                  </button>
                </>
              ) : (
                <>
                  <p>
                    تقدر تكتب وتبدأ على طول كضيف. تسجيل الدخول اختياري لأصحاب
                    الحسابات الموجودة.
                  </p>
                  {props.loginAvailable ? (
                    <form
                      className="settings-form"
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (signingIn) return;
                        setSigningIn(true);
                        setLoginError("");
                        void props
                          .onLogin(email, password)
                          .then((message) => {
                            setLoginError(message);
                            if (!message) setPassword("");
                          })
                          .finally(() => setSigningIn(false));
                      }}
                    >
                      {loginError && (
                        <p
                          id="login-alert"
                          className="alert inline"
                          role="alert"
                        >
                          {loginError}
                        </p>
                      )}
                      <label htmlFor="login-email">البريد الإلكتروني</label>
                      <input
                        id="login-email"
                        type="email"
                        dir="ltr"
                        inputMode="email"
                        autoComplete="username"
                        value={email}
                        aria-describedby={
                          loginError ? "login-alert" : undefined
                        }
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      <label htmlFor="login-password">كلمة المرور</label>
                      <div className="password-field">
                        <input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          dir="ltr"
                          autoComplete="current-password"
                          value={password}
                          aria-describedby={
                            loginError ? "login-alert" : undefined
                          }
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="ghost-icon"
                          aria-pressed={showPassword}
                          aria-label={
                            showPassword
                              ? "إخفاء كلمة المرور"
                              : "إظهار كلمة المرور"
                          }
                          onClick={() => setShowPassword((v) => !v)}
                        >
                          {showPassword ? "◡" : "◉"}
                        </button>
                      </div>
                      <button
                        type="submit"
                        className="primary"
                        disabled={signingIn}
                        aria-busy={signingIn}
                      >
                        {signingIn ? "جارٍ الدخول…" : "تسجيل الدخول"}
                      </button>
                      <p className="muted">
                        إنشاء حساب جديد واسترجاع كلمة المرور مش متاحين من هنا.
                      </p>
                    </form>
                  ) : (
                    <p className="muted">
                      تسجيل الدخول بالبريد مش مفعّل في الإعداد الحالي للخادم.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
