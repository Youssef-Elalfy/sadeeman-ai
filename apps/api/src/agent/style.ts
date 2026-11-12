/**
 * Style guard ported from the MASAR reference agent (server/src/agent/style.ts).
 * A small, high-precision check on the final reply: a reply with an issue is
 * held back once per turn and the model rewrites it (the user never sees the
 * draft). Text is never string-edited; only clear rule-level problems count.
 */
export type StyleIssue =
  | "language_mismatch"
  | "register_mismatch"
  | "self_gender"
  | "meta_project_mention"
  | "pet_name";
export type ReplyLanguage = "english" | "msa" | "egyptian";

const LETTER = /\p{L}/gu;
const ARABIC = /\p{Script=Arabic}/u;
const URL_OR_CODE = /https?:\/\/\S+|`{3}[\s\S]*?`{3}|`[^`]*`/g;
// Franco Arabic ("3ayez r7la"): Latin letters with digits for Arabic sounds.
const FRANCO = /\b[a-z]*[2356789][a-z]+\b|\b[a-z]+[2356789][a-z]*\b/i;
// The user chose a language explicitly ("answer in English", "رد بالعربي").
const LANGUAGE_REQUEST =
  /\b(in|into)\s+(english|arabic)\b|\btranslate\b|بال(عربي|عربية|انجليزي|إنجليزي|انجليزية|إنجليزية)|ترجم/i;
// Development/meta details the user did not ask about.
const META =
  /universit(y|ies)|graduation project|college project|student project|جامع(ي|ة|ية)|مشروع (تخرج|جامعي|التخرج)|system prompt|test(ing)? (mode|environment)|بيئة اختبار/i;
const ASKED_ABOUT_ORIGIN =
  /\b(who|what)\b.*\b(built|made|created|developed|behind|are you)\b|universit|project|مين|مشروع|جامع|تخرج|اتعملت|اتبنيت|صممك|طورك/i;
const PET_NAMES = /حبايبي|حبيبي|حبيبتي|يا قلبي|يا روحي/;

const EGYPTIAN = [
  "عايز",
  "عايزة",
  "عايزين",
  "عاوز",
  "إيه",
  "ايه",
  "إزاي",
  "ازاي",
  "ده",
  "دي",
  "دول",
  "كده",
  "كدا",
  "فين",
  "ليه",
  "مش",
  "بتاع",
  "بتاعة",
  "بتاعت",
  "بتاعك",
  "دلوقتي",
  "عشان",
  "علشان",
  "بقى",
  "أوي",
  "اوي",
  "خالص",
  "النهارده",
  "إمبارح",
  "زي",
  "لسه",
  "طيب",
  "الاتنين",
  "اتنين",
  "تحب",
  "تحبي",
  "إحنا",
  "احنا",
  "هنعمل",
  "هتلاقي",
];
const MSA = [
  "ماذا",
  "لماذا",
  "هل",
  "الذي",
  "التي",
  "الذين",
  "أريد",
  "اريد",
  "أود",
  "نود",
  "كيف",
  "أين",
  "متى",
  "هذا",
  "هذه",
  "هؤلاء",
  "ليس",
  "ليست",
  "سوف",
  "لدي",
  "لديكم",
  "لدينا",
  "يمكن",
  "يمكنني",
  "يمكنك",
  "حيث",
  "ينبغي",
  "أيضًا",
  "أيضاً",
  "عندما",
  "الآن",
  "ترغب",
  "تودّ",
  "تود",
];
const AR_WORD = /[\p{Script=Arabic}ً-ْ]+/gu;
const DIACRITICS = /[ً-ْ]/g;

function markerCounts(text: string): { egyptian: number; msa: number } {
  const words = (text.replace(URL_OR_CODE, " ").match(AR_WORD) ?? []).map((w) =>
    w.replace(DIACRITICS, ""),
  );
  let egyptian = 0;
  let msa = /^\s*ما\s/u.test(text) ? 1 : 0;
  for (const w of words) {
    if (EGYPTIAN.includes(w)) egyptian++;
    else if (MSA.includes(w)) msa++;
  }
  return { egyptian, msa };
}

function arabicShare(text: string): { share: number; letters: number } {
  const letters = text.replace(URL_OR_CODE, " ").match(LETTER) ?? [];
  if (letters.length === 0) return { share: 0, letters: 0 };
  return {
    share: letters.filter((c) => ARABIC.test(c)).length / letters.length,
    letters: letters.length,
  };
}

/** 'ar' | 'en' when clearly one language; null for mixed/short/Franco text. */
export function clearLanguage(text: string): "ar" | "en" | null {
  const { share, letters } = arabicShare(text);
  if (letters < 8) return null;
  if (share >= 0.6) return "ar";
  if (share <= 0.1 && !FRANCO.test(text)) return "en";
  return null;
}

/** Register of clearly Arabic text, or null when mixed/unclear. */
export function arabicRegister(text: string): "msa" | "egyptian" | null {
  if (clearLanguage(text) !== "ar") return null;
  const { egyptian, msa } = markerCounts(text);
  if (msa >= 2 && egyptian === 0) return "msa";
  if (egyptian >= 1 && egyptian > msa) return "egyptian";
  return null;
}

/** Reply language from the latest user message only (null = no hint). */
export function replyLanguage(userText: string): ReplyLanguage | null {
  const lang = clearLanguage(userText);
  if (lang === "en") return "english";
  if (lang === "ar") return arabicRegister(userText);
  return null;
}

export const REPLY_LANGUAGE_RULE: Record<ReplyLanguage, string> = {
  english: "The user's latest message is in English: answer in English.",
  msa: "The user's latest message is in Modern Standard Arabic: answer in clear, neutral Modern Standard Arabic from start to finish, with no Egyptian colloquial words (such as عايز، إيه، ده، كده، تحب، الاتنين).",
  egyptian:
    "The user's latest message is in Egyptian Arabic: answer naturally in Egyptian Arabic from start to finish, without drifting into formal Modern Standard Arabic.",
};

// Feminine first-person self-reference is drift; second person is not matched.
const SELF_FEMININE =
  /(?:^|[^\p{L}])(?:أنا\s+(?:حابة|حابه|مبسوطة|متأكدة|آسفة|اسفة|سعيدة|مستعدة|فاهمة|عارفة|شايفة)|(?:حابة|حابه|مبسوطة|متأكدة|آسفة|اسفة|سعيدة|مستعدة)\s+أ\p{Script=Arabic}+)/u;

export function styleIssues(reply: string, userText: string): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const asked = clearLanguage(userText);
  const answered = clearLanguage(reply);
  const languageRequested = LANGUAGE_REQUEST.test(userText);
  if (asked && answered && asked !== answered && !languageRequested)
    issues.push("language_mismatch");
  if (asked === "ar" && answered === "ar" && !languageRequested) {
    const wanted = arabicRegister(userText);
    const got = markerCounts(reply);
    if (wanted === "msa" && got.egyptian >= 2 && got.egyptian > got.msa)
      issues.push("register_mismatch");
    else if (wanted === "egyptian" && got.msa >= 4 && got.egyptian === 0)
      issues.push("register_mismatch");
  }
  if (SELF_FEMININE.test(reply)) issues.push("self_gender");
  if (META.test(reply) && !ASKED_ABOUT_ORIGIN.test(userText))
    issues.push("meta_project_mention");
  if (PET_NAMES.test(reply) && !PET_NAMES.test(userText))
    issues.push("pet_name");
  return issues;
}

const FIX: Record<StyleIssue, (userText: string) => string> = {
  language_mismatch: (userText) =>
    `Reply in the language of the user's latest message (${clearLanguage(userText) === "en" ? "English" : "Arabic, in the same register they used"}), unless they asked for another language.`,
  meta_project_mention: () =>
    "Do not mention universities, graduation projects, testing or how this assistant was built (the user did not ask).",
  pet_name: () => "Do not use pet names or terms of endearment.",
  register_mismatch: (userText) =>
    arabicRegister(userText) === "msa"
      ? REPLY_LANGUAGE_RULE.msa
      : REPLY_LANGUAGE_RULE.egyptian,
  self_gender: () =>
    "Refer to yourself in the masculine singular consistently (حابب، متأكد، مبسوط), never in the feminine.",
};

/** Private rewrite note for the model (never shown to the user). */
export function styleNote(issues: StyleIssue[], userText: string): string {
  return (
    "\nREWRITE REQUIRED (automatic style check, not written by the user): rewrite your previous reply. " +
    issues.map((i) => FIX[i](userText)).join(" ") +
    " Keep the same facts, sources and links. Do not mention this check."
  );
}
