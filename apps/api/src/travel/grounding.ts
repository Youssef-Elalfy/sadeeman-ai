import type { TravelConstraints } from "@sadeeman/contracts";

export const normalizeArabic = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670ـ]/gu, "")
    .replace(/[إأآ]/gu, "ا")
    .replace(/[٠-٩]/gu, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/gu, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[٬,]/gu, "")
    .replace(/٫/gu, ".")
    .toLowerCase();

// Map normalized matches back to the exact original user span, including digits/diacritics.
export function sourceSpan(text: string, quote: string) {
  const exact = text.indexOf(quote);
  if (quote && exact >= 0)
    return { start: exact, end: exact + quote.length, quote };
  let normalized = "";
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const part = normalizeArabic(text[i] ?? "");
    normalized += part;
    for (let j = 0; j < part.length; j++) offsets.push(i);
  }
  const q = normalizeArabic(quote).trim(),
    at = normalized.indexOf(q);
  if (!q || at < 0) return undefined;
  const start = offsets[at],
    last = offsets[at + q.length - 1];
  if (start === undefined || last === undefined) return undefined;
  return { start, end: last + 1, quote: text.slice(start, last + 1) };
}

const words: Record<string, number> = {
  صفر: 0,
  واحد: 1,
  واحدة: 1,
  احد: 1,
  احدى: 1,
  اثنا: 2,
  اثنتا: 2,
  اتنين: 2,
  اثنين: 2,
  اثنان: 2,
  اثنتين: 2,
  تلاتة: 3,
  تلات: 3,
  ثلاثة: 3,
  ثلاث: 3,
  اربعة: 4,
  اربع: 4,
  خمسة: 5,
  خمس: 5,
  ستة: 6,
  ست: 6,
  سبعة: 7,
  سبع: 7,
  تمانية: 8,
  تمان: 8,
  ثمانية: 8,
  ثماني: 8,
  تسعة: 9,
  تسع: 9,
  عشرة: 10,
  عشر: 10,
  حداشر: 11,
  احداشر: 11,
  اتناشر: 12,
  تلاتاشر: 13,
  اربعتاشر: 14,
  خمستاشر: 15,
  ستاشر: 16,
  سبعتاشر: 17,
  تمنتاشر: 18,
  تسعتاشر: 19,
  عشرين: 20,
  عشرون: 20,
  تلاتين: 30,
  ثلاثين: 30,
  ثلاثون: 30,
  اربعين: 40,
  اربعون: 40,
  خمسين: 50,
  خمسون: 50,
  ستين: 60,
  ستون: 60,
  سبعين: 70,
  سبعون: 70,
  تمانين: 80,
  ثمانين: 80,
  تسعين: 90,
  تسعون: 90,
  مية: 100,
  مئة: 100,
  مائه: 100,
  مائة: 100,
  ميتين: 200,
  مئتين: 200,
  تلتمية: 300,
  ثلاثمائة: 300,
  ربعمية: 400,
  خمسمية: 500,
  خمسمائة: 500,
  ستمية: 600,
  سبعمية: 700,
  تمنمية: 800,
  تسعمية: 900,
};
const scales: Record<string, { scale: number; implicit: number }> = {
  الف: { scale: 1000, implicit: 1 },
  الاف: { scale: 1000, implicit: 1 },
  الفين: { scale: 1000, implicit: 2 },
  مليون: { scale: 1000000, implicit: 1 },
  ملايين: { scale: 1000000, implicit: 1 },
  مليونين: { scale: 1000000, implicit: 2 },
};
type Token = {
  raw: string;
  start: number;
  end: number;
  value?: number;
  scale?: number;
  implicit?: number;
  join: boolean;
};
export function numberSpans(text: string) {
  const tokens: Token[] = [
    ...text.matchAll(
      /[\p{L}\p{M}]+|[٠-٩۰-۹\d]+(?:[٬,][٠-٩۰-۹\d]{3})*(?:[٫.][٠-٩۰-۹\d]+)?/gu,
    ),
  ].map((m) => {
    let raw = normalizeArabic(m[0]),
      join = false;
    if (
      raw.startsWith("و") &&
      (words[raw.slice(1)] !== undefined ||
        scales[raw.slice(1)] ||
        /^\d/.test(raw.slice(1)))
    ) {
      raw = raw.slice(1);
      join = true;
    }
    const compound = raw.split("و");
    const compoundValue =
      compound.length === 2 &&
      (words[compound[0] ?? ""] ?? 100) >= 1 &&
      (words[compound[0] ?? ""] ?? 100) < 10 &&
      (words[compound[1] ?? ""] ?? 0) >= 20
        ? (words[compound[0] ?? ""] ?? 0) + (words[compound[1] ?? ""] ?? 0)
        : undefined;
    return {
      raw,
      start: m.index,
      end: m.index + m[0].length,
      join,
      ...(compoundValue !== undefined ? { value: compoundValue } : {}),
      ...(words[raw] !== undefined
        ? { value: words[raw] }
        : /^\d+(?:\.\d+)?$/.test(raw)
          ? { value: Number(raw) }
          : {}),
      ...scales[raw],
    };
  });
  for (let i = tokens.length - 2; i >= 0; i--) {
    if (tokens[i]?.raw === "و" && tokens[i + 1]) {
      const next = tokens[i + 1];
      if (next) next.join = true;
      tokens.splice(i, 1);
    }
  }
  const result: {
    value: number;
    start: number;
    end: number;
    magnitude: boolean;
  }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i];
    if (!first || (first.value === undefined && first.scale === undefined))
      continue;
    let group = 0,
      total = 0,
      previousScale = Infinity,
      end = first.end,
      magnitude = false,
      groupPresent = false,
      valid = true;
    let j = i;
    for (; j < tokens.length; j++) {
      const t = tokens[j];
      if (!t || (t.value === undefined && t.scale === undefined)) break;
      if (
        j > i &&
        (!/^\s*(?:و\s*)?$/u.test(text.slice(tokens[j - 1]?.end, t.start)) ||
          (t.value !== undefined &&
            !t.join &&
            !(t.value === 10 && group > 0 && group < 10)))
      )
        break;
      if (t.scale !== undefined) {
        if (t.scale >= previousScale || (t.implicit === 2 && group !== 0))
          valid = false;
        total += (groupPresent ? group : (t.implicit ?? 1)) * t.scale;
        group = 0;
        groupPresent = false;
        previousScale = t.scale;
        magnitude = true;
      } else {
        if (
          groupPresent &&
          t.join &&
          !(
            (group % 100 < 10 &&
              (t.value ?? 0) >= 20 &&
              (t.value ?? 0) < 100) ||
            (group >= 100 && group % 100 === 0 && (t.value ?? 0) < 100)
          )
        )
          valid = false;
        group += t.value ?? 0;
        groupPresent = true;
      }
      end = t.end;
    }
    const value = total + group;
    if (valid && Number.isFinite(value))
      result.push({ value, start: first.start, end, magnitude });
    i = j - 1;
  }
  return result;
}

export class GroundingError extends Error {
  constructor(
    message: string,
    readonly field: keyof TravelConstraints,
  ) {
    super(message);
  }
}
export class ConstraintIssues extends GroundingError {
  constructor(readonly issues: GroundingError[]) {
    const first = issues[0];
    if (!first) throw new Error("Missing constraint issue");
    super(first.message, first.field);
  }
}
const units = {
  days: /^(?:ايام|يوم|days?)(?![\p{L}])/u,
  travellers:
    /^(?:اشخاص|شخص|افراد|فرد|مسافرين|مسافر|travellers?|travelers?|people|persons?)(?![\p{L}])/u,
  adults: /^(?:بالغين|بالغ|كبار|adults?)(?![\p{L}])/u,
  children: /^(?:اطفال|طفل|children|child)(?![\p{L}])/u,
};
export function numericGrounded(
  text: string,
  span: { start: number; end: number; quote: string },
  value: number,
  field: "days" | "travellers" | "adults" | "children" | "budgetMinor",
  minorUnits = false,
) {
  const q = normalizeArabic(span.quote);
  const duals =
    field === "days"
      ? /(?:^|\s)(?:يومين|يومان)(?=$|[\s،.])/u
      : field === "travellers"
        ? /(?:^|\s)(?:شخصين|شخصان|فردين|مسافرين اتنين)(?=$|[\s،.])/u
        : field === "children"
          ? /(?:^|\s)(?:طفلين|طفلان|اتنين اطفال)(?=$|[\s،.])/u
          : /(?:^|\s)بالغين اتنين(?=$|[\s،.])/u;
  if (
    value === 1 &&
    (field === "adults"
      ? /^(?:بالغ|شخص بالغ)$/u
      : field === "children"
        ? /^طفل$/u
        : /a^/u
    ).test(q)
  )
    return true;
  if (
    field === "children" &&
    value === 0 &&
    /بدون اطفال|من غير اطفال|مفيش اطفال/u.test(q)
  )
    return true;
  if (
    value === 2 &&
    duals.test(q) &&
    !/مش\s+(?:شخصين|يومين|فردين)/u.test(q) &&
    !/(?:مش|ليس)\s*$/u.test(normalizeArabic(text.slice(0, span.start)))
  )
    return true;
  const candidates = numberSpans(span.quote).filter((n) => {
    const following = normalizeArabic(
      text.slice(span.start + n.end),
    ).trimStart();
    const absoluteStart = span.start + n.start,
      absoluteEnd = span.start + n.end;
    if (
      /(?:مش(?:\s+عايز)?|ليس|بدل)\s*$/u.test(
        normalizeArabic(text.slice(0, absoluteStart)),
      )
    )
      return false;
    if (
      /^(?:ليالي|ليلة|ساعات|ساعة|سنوات|سنة|غرف|غرفة|nights?|hours?|rooms?)(?![\p{L}])/u.test(
        following,
      )
    )
      return false;
    if (
      /[\p{N}]/u.test(text[absoluteStart - 1] ?? "") ||
      /^[\p{N}]/u.test(text.slice(absoluteEnd))
    )
      return false;
    if (
      !n.magnitude &&
      /^(?:الف|الاف|الفين|مليون|ملايين)(?![\p{L}])/u.test(following)
    )
      return false;
    if (
      /^[%٪]/u.test(following) ||
      /[-−]\s*$/u.test(text.slice(0, absoluteStart))
    )
      return false;
    if (
      /^[-/]\d/u.test(following) ||
      /[\d][-/]$/u.test(normalizeArabic(text.slice(0, span.start + n.start)))
    )
      return false;
    const before = normalizeArabic(span.quote.slice(0, n.start));
    if (/(?:مش|ليس|بدل)\s*$/u.test(before)) return false;
    // Earlier values in an explicit replacement must not become the new value.
    if (
      /(?:خلي|خلى|خليهم|بقينا|بدلا من)\s/u.test(
        normalizeArabic(span.quote.slice(n.end)),
      )
    )
      return false;
    const typed = Object.entries(units).find(([, pattern]) =>
      pattern.test(following),
    )?.[0];
    if (typed) return typed === field;
    if (field === "budgetMinor")
      return (
        !/^(?:ليالي|ليلة|nights?)(?![\p{L}])/u.test(following) &&
        (!minorUnits || /قرش|minor units|cents/i.test(span.quote))
      );
    // A currency amount cannot ground a traveler count or duration.
    return (
      !n.magnitude &&
      !/^(?:جنيه|دولار|egp|usd|eur|قرش|ليالي|ليلة)(?![\p{L}])/u.test(following)
    );
  });
  return candidates.some((n) => n.value === value);
}

export function currencyGrounded(
  quote: string,
  userText: string,
  value: string,
  confirmed?: string,
) {
  const q = normalizeArabic(quote),
    full = normalizeArabic(userText);
  const explicit: Record<string, RegExp> = {
    EGP: /(?:\begp\b|جنيه مصري|الجنيه المصري|عملة مصر)/u,
    USD: /(?:\busd\b|دولار امريكي)/u,
    GBP: /(?:\bgbp\b|جنيه استرليني)/u,
    EUR: /(?:\beur\b|يورو)/u,
    JPY: /(?:\bjpy\b|ين ياباني)/u,
  };
  if (explicit[value]?.test(q)) return true;
  if (/جنيه/u.test(q)) {
    if (
      /استرليني|سوداني|sudan|gbp/u.test(q) ||
      (/جنيه\s+(?:استرليني|سوداني)/u.test(full) && !/مصري/u.test(q))
    )
      return false;
    if (
      value === "EGP" &&
      (confirmed === "EGP" ||
        /(?:انا|احنا)\s+(?:في|من)\s+مصر|(?:ميزانيتي|ميزانيتنا)\s+بالعملة المصرية/u.test(
          full,
        ))
    )
      return true;
    throw new GroundingError("CURRENCY_AMBIGUOUS", "currency");
  }
  if (/دولار/u.test(q) && !/كندي|استرالي|نيوزيلندي/u.test(q)) {
    if (value === confirmed && ["USD", "CAD", "AUD", "NZD"].includes(value))
      return true;
    throw new GroundingError("CURRENCY_AMBIGUOUS", "currency");
  }
  return false;
}

export function budgetBasisGrounded(
  quote: string,
  value: string,
  previous: TravelConstraints,
) {
  const q = normalizeArabic(quote);
  const per = /per person|للفرد|لكل فرد/u.test(q);
  if (value === "per_person") return per;
  if (per) return false;
  return (
    /total|اجمال|كلنا|ميزانيتنا/u.test(q) ||
    (previous.travellers === 1 && /ميزانيتي|معايا|في حدود/u.test(q))
  );
}
