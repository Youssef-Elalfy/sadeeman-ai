/**
 * Local, deterministic conversation titles from the user's FIRST message.
 * No model tokens are spent. Unknown shapes fall back to a shortened,
 * filler-free version of the user's own words (nothing is invented).
 */
const languages: Record<string, string> = {
  انجليزي: "اللغة الإنجليزية",
  إنجليزي: "اللغة الإنجليزية",
  انجليزى: "اللغة الإنجليزية",
  english: "اللغة الإنجليزية",
  فرنساوي: "اللغة الفرنسية",
  فرنسي: "اللغة الفرنسية",
  french: "اللغة الفرنسية",
  الماني: "اللغة الألمانية",
  ألماني: "اللغة الألمانية",
  german: "اللغة الألمانية",
  اسباني: "اللغة الإسبانية",
  إسباني: "اللغة الإسبانية",
  spanish: "اللغة الإسبانية",
};
const fillers =
  /^(?:(?:انا|أنا|عايز|عاوز|عايزة|محتاج|ممكن|لو سمحت|من فضلك|please|can you|could you|i want to|i want|i'd like to|help me|ساعدني|ساعدنى)\s+)+/iu;
const MAX = 40;

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX) return clean;
  const cut = clean.slice(0, MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim()}…`;
}

export function deriveTitle(message: string): string {
  const text = message
    .replace(/[‎‏]/g, "")
    .replace(/[؟?!,،؛:"'()[\]{}]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "محادثة جديدة";

  // Travel: "عايز أسافر تركيا", "رحلة لليابان", "trip to Japan".
  const ar = text.match(
    /(?:أسافر|اسافر|سافر|نسافر|السفر|رحلة|رحله|أزور|ازور|زيارة)\s+(?:إلى|الى|ل|لـ|على|في)?\s*([\p{L}]+)/u,
  );
  if (ar?.[1] && !/^(مع|بميزانية|لمدة|كام|يوم|أيام)$/u.test(ar[1])) {
    const place = ar[1].replace(/^(?:لل|ل)(?=\p{L}{3,})/u, "");
    return clip(`رحلة إلى ${place}`);
  }
  const en = text.match(
    /\b(?:trip|travel|travelling|traveling|visit|vacation)\s+(?:to|in)?\s*([A-Z][\p{L}]+)/u,
  );
  if (en?.[1]) return clip(`Trip to ${en[1]}`);

  // Comparison: "إيه الفرق بين React وNext.js".
  const diff = text.match(/الفرق بين\s+(.+)$/u);
  if (diff?.[1]) return clip(`الفرق بين ${diff[1]}`);

  // Explain: "اشرحلي يعني إيه الذكاء الاصطناعي ببساطة", "explain recursion".
  const explain = text.match(
    /^(?:اشرحلي|اشرح لي|اشرح|وضحلي|وضح|فهمني|explain)\s+(?:(?:يعني\s+)?(?:إيه|ايه|ما هو|ما هي|what is|what are)\s+)?(.+)$/iu,
  );
  if (explain?.[1])
    return clip(
      `شرح ${explain[1].replace(/\s+(?:ببساطة|بالتفصيل|simply)$/iu, "")}`,
    );
  const whatIs = text.match(/^(?:يعني\s+)?(?:إيه|ايه)\s+(?:هو|هي)?\s*(.+)$/u);
  if (whatIs?.[1]) return clip(`ما هو ${whatIs[1]}`);

  // Learning: "ساعدني أتعلم إنجليزي".
  const learn = text.match(
    /(?:أتعلم|اتعلم|نتعلم|تعلم|learn|learning)\s+(.+)$/iu,
  );
  if (learn?.[1]) {
    const topic = learn[1]
      .replace(/\s+(?:من الصفر|from scratch)$/iu, "")
      .trim();
    const lang = languages[topic.toLowerCase()];
    return clip(`تعلم ${lang ?? topic}`);
  }

  return clip(text.replace(fillers, "") || text);
}

const key = "sadeeman.titles";
export function readTitles(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(
          Object.entries(raw).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}
/** A title is written once; later messages never change it. */
export function rememberTitle(id: string, title: string, force = false) {
  try {
    const titles = readTitles();
    if (titles[id] && !force) return titles;
    titles[id] = title;
    localStorage.setItem(key, JSON.stringify(titles));
    return titles;
  } catch {
    return readTitles();
  }
}
