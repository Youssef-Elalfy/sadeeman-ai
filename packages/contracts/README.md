# Shared M1/M2 contracts

`src/index.ts` exports strict Zod schemas/types for messages/client request IDs, locales, resources, actual streaming events, evidence classes, model tool calls/results, package search and integer money inputs. M2 adds explicit versioned memory consent, save/correction payloads, owned memory records and extractive conversation summaries. Build with `pnpm --filter @sadeeman/contracts build`. API imports this package; future web implementation should share it.

Original `contracts/` remains the broader target outline. CRM/lead/quote/handoff schemas and mutation tools remain future scope. A model-proposed boolean is never a customer consent record.
