import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

async function main(): Promise<void> {
  if (
    !process.argv.includes("--public-data") &&
    !process.argv.includes("--synthetic")
  ) {
    process.stderr.write(
      "Run pnpm chat --public-data to acknowledge public, nonsensitive conversation. --synthetic is reserved for explicit test environments.\n",
    );
    process.exitCode = 1;
  } else {
    const base = "http://127.0.0.1:4000";
    const status = (await fetch(`${base}/api/v1/health`).then((r) =>
      r.json(),
    )) as { model: string; dataMode: string; persistence: string };
    if (
      process.argv.includes("--synthetic") &&
      status.dataMode !== "synthetic_only"
    ) {
      stdout.write(
        "--synthetic is unavailable outside a test server. Use --public-data for genuine conversation.\n",
      );
      process.exitCode = 2;
      return;
    }
    if (status.model === "disconnected") {
      stdout.write(
        "SADEEMAN AI — DISCONNECTED. Configure a real provider and model locally. No AI response was generated.\n",
      );
    } else {
      const response = await fetch(
        `${base}${status.persistence === "supabase" ? "/api/v1/auth/guest" : "/api/v1/dev/sessions"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            status.dataMode === "synthetic_only"
              ? { acceptSyntheticDataPolicy: true }
              : { acceptPublicDataPolicy: true },
          ),
        },
      );
      if (!response.ok) throw new Error("Local session unavailable");
      const { token } = (await response.json()) as { token: string };
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const conversation = await fetch(`${base}/api/v1/conversations`, {
        method: "POST",
        headers,
        body: "{}",
      });
      if (!conversation.ok) throw new Error("Conversation unavailable");
      const { id } = (await conversation.json()) as { id: string };
      const terminal = createInterface({ input: stdin, output: stdout });
      stdout.write(
        "سَدِيمًا | SADEEMAN AI · public, nonsensitive conversation · /exit to quit\n",
      );
      try {
        while (true) {
          const content = await terminal.question("You: ");
          if (content === "/exit") break;
          if (!content.trim()) continue;
          const turn = await fetch(`${base}/api/v1/agent/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ conversationId: id, content }),
          });
          if (!turn.ok) {
            stdout.write(
              `Request unavailable (${turn.status}). Your text was not answered.\n`,
            );
            continue;
          }
          const { runId } = (await turn.json()) as { runId: string };
          const events = await fetch(`${base}/api/v1/agent/events/${runId}`, {
            headers,
          });
          if (!events.ok || !events.body) {
            stdout.write("Events unavailable; retry later.\n");
            continue;
          }
          const decoder = new TextDecoder();
          let pending = "";
          for await (const chunk of events.body) {
            pending += decoder.decode(chunk, { stream: true });
            let boundary = pending.indexOf("\n\n");
            while (boundary !== -1) {
              const frame = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              const data = frame
                .split("\n")
                .find((line) => line.startsWith("data: "));
              if (data) {
                const event = JSON.parse(data.slice(6)) as {
                  type: string;
                  textDelta?: string;
                  safeStatus?: string;
                  toolName?: string;
                };
                if (event.type === "response_completed")
                  stdout.write(`SADEEMAN: ${event.textDelta ?? ""}\n`);
                if (event.type === "tool_started")
                  stdout.write(`[tool: ${event.toolName ?? "unknown"}]\n`);
                if (
                  event.type === "run_failed" ||
                  event.type === "run_canceled"
                )
                  stdout.write(
                    `[${event.safeStatus ?? "Unavailable"} — no completed AI answer]\n`,
                  );
              }
              boundary = pending.indexOf("\n\n");
            }
          }
        }
      } finally {
        terminal.close();
      }
    }
  }
}
void main().catch(() => {
  process.stderr.write(
    "Local API unavailable. Start pnpm dev, then retry. No completed AI answer was received.\n",
  );
  process.exitCode = 1;
});
