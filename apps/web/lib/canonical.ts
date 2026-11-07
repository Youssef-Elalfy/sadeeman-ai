export const CANONICAL_ORIGIN = "https://sadeeman-ai.vercel.app";

/** Hosted document navigation only; never trusts a redirect target from input. */
export function canonicalDestination(
  url: URL,
  hosted: boolean,
): URL | undefined {
  if (
    !hosted ||
    url.protocol !== "https:" ||
    url.hostname === "sadeeman-ai.vercel.app" ||
    !url.hostname.endsWith(".vercel.app")
  )
    return undefined;
  const destination = new URL(CANONICAL_ORIGIN);
  destination.pathname = url.pathname;
  destination.search = url.search;
  return destination;
}
