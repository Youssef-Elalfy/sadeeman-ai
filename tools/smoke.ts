import assert from "node:assert/strict";

const base = "http://127.0.0.1:4000";
const health = await fetch(`${base}/api/v1/health`);
assert.equal(health.status, 200);
const status = (await health.json()) as {
  model: string;
  persistence: string;
  dataMode: string;
};
assert.equal(status.persistence, "ephemeral");
const session = await fetch(`${base}/api/v1/dev/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(
    status.dataMode === "synthetic_only"
      ? { acceptSyntheticDataPolicy: true }
      : { acceptPublicDataPolicy: true },
  ),
});
assert.equal(session.status, 201);
const { token } = (await session.json()) as { token: string };
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const conversation = await fetch(`${base}/api/v1/conversations`, {
  method: "POST",
  headers,
  body: "{}",
});
assert.equal(conversation.status, 201);
const { id } = (await conversation.json()) as { id: string };
const unauthorized = await fetch(`${base}/api/v1/conversations/${id}`);
assert.equal(unauthorized.status, 401);
// Offline smoke never sends even synthetic text to an enabled paid provider.
if (status.model === "disconnected") {
  const response = await fetch(`${base}/api/v1/agent/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversationId: id,
      content: "Synthetic local smoke",
      locale: "en",
    }),
  });
  assert.equal(response.status, 503);
  assert.equal(
    ((await response.json()) as { error: string }).error,
    "DISCONNECTED",
  );
  process.stdout.write(
    "PASS: real HTTP health 200; session 201; conversation 201; unauthorized 401; disconnected chat 503. No provider call.\n",
  );
} else
  process.stdout.write(
    "PASS: real HTTP health/session/conversation/auth. Provider configured; live generation deliberately not invoked by offline smoke.\n",
  );
