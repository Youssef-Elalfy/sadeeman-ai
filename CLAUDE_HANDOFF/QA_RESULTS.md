# Final local QA results

Latest run: **2026-11-06, Claude takeover**, Windows 10, Node 24.14.1. Full evidence is in `docs/reports/FINAL_SADEEMAN_RELEASE_REVIEW.md` §G.

| Exact command | Observed outcome |
|---|---|
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1` (same as `pnpm test --maxWorkers=1`) | **352/352 PASS**, 29/29 files (baseline was 343 + 9 new regression tests) |
| `tsc --noEmit` for contracts, API, web, and tests+tools | **PASS** (4/4) |
| `biome check .` | **PASS**, 116 files |
| `next build` | **PASS** |
| `node tools/run-e2e.ts` (`pnpm test:e2e`) | **9/9 PASS** on the final run. The run before it had 1 timing failure (mobile guest call >10 s during a concurrent build), which passed on rerun without code changes |
| `node tools/dev.ts` | Starts both services. Guest POST from `127.0.0.1:3000` → 201. Clean stop |

Under Git Bash, `pnpm exec vitest` hung in this environment. Calling vitest through `node` works. PowerShell `pnpm test` was not re-checked.

Zero paid provider calls, live searches, real microphone recordings, Supabase writes, Auth changes, or Cloud migrations were made. The only Cloud access was a read-only log query. The unverified gates are unchanged: live M3 dialogue, CRM Cloud migration, Cloud claim/expiry fixture, live voice and device quality, and Supabase anonymous sign-ins.
