import { SafeError } from "../errors.js";
import type { ResearchScope } from "./scope.js";
import { safeSourceUrl } from "./tavily.js";

/**
 * Identity of a cited page for matching purposes only. Two spellings of the
 * SAME returned page (http/https, `www.`, host case, a trailing slash, a
 * fragment) must not fail an otherwise grounded answer. Path and query stay
 * significant, so a URL that was never returned still cannot match.
 */
export function citationKey(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (u.username || u.password) return undefined;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${u.search}`;
  } catch {
    return undefined;
  }
}

export function validateResearchCitations(
  text: string,
  scope: ResearchScope,
): void {
  if (!scope.searchCalls && !scope.usedEvidence) return;
  const allowed = new Set(
    [...scope.sources.values()]
      .map((s) => citationKey(s.url))
      .filter((key): key is string => Boolean(key)),
  );
  // RTL answers often carry invisible bidi marks next to links; they are never
  // part of a URL.
  const clean = text.replace(/[‎‏‪-‮⁦-⁩]/gu, " ");
  const links = clean.match(/https?:\/\/[^\s<>"`]+/gu) ?? [];
  let matched = 0;
  for (const link of links) {
    let candidate = link,
      found = false;
    // Try the full link first (Arabic URL paths are valid), then peel trailing
    // punctuation or Arabic letters glued to the link one character at a time.
    for (let i = 0; i < 64; i++) {
      // The cited page must still be a safe public URL, and must equal a
      // returned source up to the harmless spelling differences above.
      const safe =
        safeSourceUrl(candidate) ??
        safeSourceUrl(candidate.replace(/^http:/i, "https:"));
      const key = safe ? citationKey(safe) : undefined;
      if (key && allowed.has(key)) {
        found = true;
        matched++;
        break;
      }
      const last = candidate.at(-1) ?? " ";
      if (
        !".,،؛:!?؟)]}*'»”’…".includes(last) &&
        !/\p{Script=Arabic}/u.test(last)
      )
        break;
      candidate = candidate.slice(0, -1);
    }
    if (!found) throw new SafeError("UNGROUNDED_RESPONSE");
  }
  if (allowed.size && !matched) throw new SafeError("UNGROUNDED_RESPONSE");
}
