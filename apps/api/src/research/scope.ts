import {
  ResearchData,
  type ToolResult,
  type TravelSource,
} from "@sadeeman/contracts";

export interface ResearchScope {
  ownerId: string;
  conversationId: string;
  runId: string;
  searchCalls: number;
  sources: Map<string, TravelSource>;
  destinations: Map<string, Set<string>>;
  cache: Map<string, ToolResult>;
  usedEvidence?: boolean;
}
export function researchScope(
  ownerId: string,
  conversationId: string,
  runId: string,
  previous?: ResearchScope,
  now = Date.now(),
): ResearchScope {
  const scope: ResearchScope = {
    ownerId,
    conversationId,
    runId,
    searchCalls: 0,
    sources: new Map(),
    destinations: new Map(),
    cache: new Map(),
  };
  // Short-lived, same-owner/conversation public research only. This is not
  // long-term memory or a claim that old results are fresh/live inventory.
  if (
    previous?.ownerId !== ownerId ||
    previous.conversationId !== conversationId
  )
    return scope;
  for (const source of [...previous.sources.values()].slice(-24)) {
    const age = now - Date.parse(source.retrievedAt);
    if (age < 0 || age > 600000) continue;
    scope.sources.set(source.id, structuredClone(source));
    scope.destinations.set(
      source.id,
      new Set(previous.destinations.get(source.id) ?? []),
    );
  }
  for (const [key, value] of [...previous.cache.entries()].slice(-8)) {
    const data = ResearchData.safeParse(value.data);
    if (
      value.status === "ok" &&
      data.success &&
      data.data.sources.every((s) => scope.sources.has(s.id))
    )
      scope.cache.set(key, structuredClone(value));
  }
  return scope;
}
export function destinationKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}
