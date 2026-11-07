import { readFileSync } from "node:fs";

const lines = readFileSync(
  new URL("./scenarios.jsonl", import.meta.url),
  "utf8",
)
  .trim()
  .split(/\r?\n/);
const byDependency: Record<string, number> = {};
const ids = new Set<string>();
for (const line of lines) {
  const row = JSON.parse(line) as {
    id: string;
    requires: string;
    input: string;
    expected: string;
  };
  if (!row.id || !row.input || !row.expected || ids.has(row.id))
    throw new Error("Invalid evaluation catalog");
  ids.add(row.id);
  byDependency[row.requires] = (byDependency[row.requires] ?? 0) + 1;
}
process.stdout.write(
  `${JSON.stringify({ specificationCount: lines.length, behavioralScenariosExecuted: 0, byDependency, status: "INVENTORY_ONLY_NOT_BEHAVIORAL_PASSES", reason: "Live model, DB, research, audio and browser scenario runners are later gates. M1 deterministic tests are separate." }, null, 2)}\n`,
);
