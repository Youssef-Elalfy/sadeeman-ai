import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLocalDatabase,
  type LocalDatabase,
} from "../apps/api/src/persistence/local.js";
import { Repository } from "../apps/api/src/persistence/repository.js";

let store: LocalDatabase;
beforeAll(async () => {
  store = await createLocalDatabase();
}, 30000);
afterAll(async () => {
  await store?.close();
});
async function user() {
  const session = await store.guest();
  const identity = await store.authenticate(`Bearer ${session.token}`);
  return { identity, repo: new Repository(store, identity) };
}
const record = () => ({
  callId: randomUUID(),
  toolName: "estimate_trip_budget",
  status: "ok" as const,
  resultCode: null,
  durationMs: 3,
  occurredAt: new Date().toISOString(),
});
describe("real PostgreSQL tool execution metadata, no prompts or tool payloads stored", () => {
  it("commits metadata and messages atomically, deduplicates retries, and isolates another user", async () => {
    const a = await user(),
      b = await user(),
      c = await a.repo.createConversation(),
      rid = randomUUID(),
      requestId = randomUUID(),
      execution = record();
    await a.repo.commit(
      c.id,
      requestId,
      rid,
      "Synthetic input",
      "Synthetic answer",
      { inputTokens: 1, outputTokens: 1 },
      [execution],
    );
    await a.repo.commit(
      c.id,
      requestId,
      rid,
      "Synthetic input",
      "Synthetic answer",
      { inputTokens: 1, outputTokens: 1 },
      [execution],
    );
    expect(await a.repo.tools(c.id)).toHaveLength(1);
    await expect(b.repo.tools(c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(JSON.stringify(await a.repo.tools(c.id))).not.toContain(
      "Synthetic input",
    );
    expect((await a.repo.conversation(c.id)).messages).toHaveLength(2);
  });
  it("can persist failure metadata without asserting a completed conversation turn", async () => {
    const a = await user(),
      c = await a.repo.createConversation();
    await a.repo.saveTools(c.id, randomUUID(), [
      { ...record(), status: "failed", resultCode: "TOOL_FAILED" },
    ]);
    expect((await a.repo.tools(c.id))[0]?.status).toBe("failed");
    expect((await a.repo.conversation(c.id)).messages).toEqual([]);
  });
  it("rolls back successful message writes if a metadata insert fails its real database constraint", async () => {
    const a = await user(),
      c = await a.repo.createConversation();
    await store.db.exec(
      "alter table public.sadeeman_tool_executions add constraint reject_test_metadata check(tool_name<>'rejected_test_tool')",
    );
    await expect(
      a.repo.commit(
        c.id,
        randomUUID(),
        randomUUID(),
        "Synthetic input",
        "Synthetic answer",
        { inputTokens: 1, outputTokens: 1 },
        [{ ...record(), toolName: "rejected_test_tool" }],
      ),
    ).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    expect((await a.repo.conversation(c.id)).messages).toEqual([]);
  });
});
