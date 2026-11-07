import { readFileSync } from "node:fs";
import { z } from "zod";
import { loadConfig } from "../apps/api/dist/config.js";

// Read-only runtime-key checks. Never applies SQL, creates an identity or calls a model.
try {
  const config = loadConfig();
  const target = z
    .object({ projectRef: z.string(), apiUrl: z.url() })
    .parse(
      JSON.parse(
        readFileSync(
          new URL("../config/supabase-target.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  if (
    config.PERSISTENCE_MODE !== "supabase" ||
    config.SUPABASE_PROJECT_REF !== target.projectRef ||
    config.SUPABASE_URL !== target.apiUrl
  ) {
    throw new Error(
      "Configuration does not select the verified Sadeeman project",
    );
  }
  const headers = { apikey: config.SUPABASE_PUBLISHABLE_KEY };
  const auth = await fetch(`${target.apiUrl}/auth/v1/settings`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!auth.ok) {
    await auth.body?.cancel();
    process.stdout.write(
      `${JSON.stringify({ projectRef: target.projectRef, authStatus: auth.status, runtimeKeyAccepted: false, remoteChanges: 0 })}\n`,
    );
    process.exitCode = 1;
  } else {
    const settings = z
      .object({
        external: z
          .object({ anonymous_users: z.boolean().optional() })
          .optional(),
      })
      .parse(await auth.json());
    const database = await fetch(
      `${target.apiUrl}/rest/v1/sadeeman_conversations?select=id&limit=0`,
      { headers, redirect: "error", signal: AbortSignal.timeout(10000) },
    );
    let databaseCode: string | null = null;
    if (!database.ok) {
      const error = z
        .object({ code: z.string().regex(/^[A-Z0-9_]{1,20}$/) })
        .safeParse(await database.json());
      if (error.success) databaseCode = error.data.code;
    } else await database.body?.cancel();
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "READ_ONLY_RUNTIME_PREFLIGHT",
          projectRef: target.projectRef,
          authStatus: auth.status,
          runtimeKeyAccepted: true,
          anonymousEnabled: settings.external?.anonymous_users ?? null,
          anonymousEnabledLocally: config.ENABLE_SUPABASE_GUEST,
          postgrestStatus: database.status,
          databaseCode,
          authenticatedRlsVerified: false,
          remoteChanges: 0,
          realModelCalls: 0,
        },
        null,
        2,
      )}\n`,
    );
  }
} catch {
  process.stdout.write(
    "Read-only cloud preflight failed; inspect local target, credentials and connectivity. No remote changes or authenticated RLS pass claimed.\n",
  );
  process.exitCode = 1;
}
