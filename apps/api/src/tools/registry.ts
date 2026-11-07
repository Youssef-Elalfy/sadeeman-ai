import {
  BudgetInput,
  ConstraintProposal,
  PackageQuery,
  type ToolCall,
  ToolResult,
  TravelReadinessRequest,
} from "@sadeeman/contracts";
import { z } from "zod";
import type { Identity } from "../persistence/types.js";
import { withinDeadline } from "../providers/router.js";
import type { ToolDefinition } from "../providers/types.js";
import type { ResearchScope } from "../research/scope.js";
import type { TravelIntelligence } from "../research/travel.js";
import {
  constraintConflict,
  proposeConstraints,
  type TravelTurn,
} from "../travel/context.js";
import { assessTravel } from "../travel/decision.js";
import { ConstraintIssues, GroundingError } from "../travel/grounding.js";

export interface ToolContext {
  ownerId: string;
  conversationId: string;
  signal: AbortSignal;
  research?: ResearchScope;
  identity?: Identity;
  travel?: TravelTurn;
  lastAssistantText?: string;
}
interface RegisteredTool {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  timeoutMs: number;
  sideEffect: boolean;
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}
export interface CatalogRepository {
  register?(registry: ToolRegistry): void;
  search(
    input: z.infer<typeof PackageQuery>,
    context: ToolContext,
  ): Promise<ToolResult>;
}
// Deliberately no fixtures in application code. A missing database is not an empty catalog.
export class UnavailableCatalog implements CatalogRepository {
  async search(): Promise<ToolResult> {
    return {
      status: "unavailable",
      evidence: "unavailable",
      code: "CATALOG_DATABASE_NOT_CONNECTED",
    };
  }
}
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) throw new Error("Duplicate tool");
    // M1 deliberately has no durable authorization store: all mutations fail closed.
    if (tool.sideEffect)
      throw new Error(
        "Mutation tools require the M2/M4 durable authorization boundary",
      );
    this.tools.set(tool.name, tool);
  }
  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.input),
    }));
  }
  has(name: string): boolean {
    return this.tools.has(name);
  }
  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool || tool.sideEffect)
      return {
        status: "rejected",
        evidence: "unavailable",
        code: "TOOL_NOT_AUTHORIZED",
      };
    if (Buffer.byteLength(JSON.stringify(call.arguments)) > 16000)
      return {
        status: "rejected",
        evidence: "unavailable",
        code: "TOOL_ARGUMENT_LIMIT",
      };
    const input = tool.input.safeParse(call.arguments);
    if (!input.success)
      return {
        status: "rejected",
        evidence: "unavailable",
        code: "INVALID_TOOL_ARGUMENTS",
        data: {
          validationIssues: input.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path
              .map((part) =>
                String(part)
                  .replace(/[^a-zA-Z0-9_]/g, "")
                  .slice(0, 80),
              )
              .join(".")
              .slice(0, 160),
            code: issue.code,
            ...("expected" in issue ? { expectedType: issue.expected } : {}),
            ...(issue.code === "unrecognized_keys"
              ? {
                  unrecognizedFields: issue.keys
                    .filter((key) => /^[a-zA-Z][a-zA-Z_]{0,39}$/.test(key))
                    .slice(0, 8),
                }
              : {}),
          })),
        },
      };
    if (
      ["compare_travel_options", "estimate_trip_budget"].includes(call.name) &&
      context.travel?.draft.budgetBasisConfidence === "shared_intent"
    )
      return {
        status: "unavailable",
        evidence: "unavailable",
        code: "CLARIFICATION_REQUIRED",
        data: assessTravel(
          "budget_comparison",
          context.travel.draft,
          context.lastAssistantText,
        ),
      };
    const conflicts = constraintConflict(call.name, input.data, context.travel);
    if (conflicts.length)
      return {
        status: "rejected",
        evidence: "unavailable",
        code: "CONSTRAINT_CONFLICT",
        data: {
          fields: conflicts,
          correction:
            "Preserve confirmed constraints or propose an explicit user-supported change first.",
        },
      };
    try {
      const result = await withinDeadline(
        (signal) => tool.execute(input.data, { ...context, signal }),
        context.signal,
        tool.timeoutMs,
      );
      const parsed = tool.output.safeParse(result);
      if (
        !parsed.success ||
        Buffer.byteLength(JSON.stringify(parsed.data)) > 24000
      )
        return {
          status: "failed",
          evidence: "unavailable",
          code: "INVALID_TOOL_OUTPUT",
        };
      return ToolResult.parse(parsed.data);
    } catch {
      return {
        status: "failed",
        evidence: "unavailable",
        code: context.signal.aborted ? "TOOL_CANCELED" : "TOOL_FAILED",
      };
    }
  }
}
export function createTools(
  catalog: CatalogRepository = new UnavailableCatalog(),
  research?: TravelIntelligence,
  travelContext = false,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (travelContext) {
    registry.register({
      name: "assess_travel_request",
      description:
        "Choose ASK, ACT or ANSWER for the intended next action from grounded context. Basic itinerary/research never require age breakdown or all budget details. Ask one material question only; do not repeat an already asked question.",
      input: TravelReadinessRequest,
      output: ToolResult,
      timeoutMs: 1000,
      sideEffect: false,
      execute: async (raw, context) => ({
        status: "ok",
        evidence: "general_information",
        data: assessTravel(
          TravelReadinessRequest.parse(raw).action,
          context.travel?.draft ?? { version: 0, constraints: {}, options: [] },
          context.lastAssistantText,
        ),
      }),
    });
    registry.register({
      name: "propose_travel_constraints",
      description:
        "Stage explicitly supported changes only, with one exact evidence quote per changed field INCLUDING budgetBasis. Unknown adults/children/flights remain omitted. People/persons never implies adults. Omit unchanged fields. Shared-budget wording records intent; confirm before financial comparisons. Never invent reductions, ages, prices or currency. Previous-user evidence may fill an unknown field during clarification, never overwrite confirmed facts. Changes commit with a successful answer.",
      input: ConstraintProposal,
      output: ToolResult,
      timeoutMs: 1000,
      sideEffect: false,
      execute: async (raw, context) => {
        if (!context.travel)
          return {
            status: "unavailable",
            evidence: "unavailable",
            code: "TRAVEL_CONTEXT_UNAVAILABLE",
          };
        try {
          return {
            status: "ok",
            evidence: "general_information",
            data: proposeConstraints(
              ConstraintProposal.parse(raw),
              context.travel,
            ),
          };
        } catch (error) {
          const codes = [
            "TRAVEL_VERSION_CONFLICT",
            "CURRENCY_CHANGE_REQUIRES_EXPLICIT_AMOUNT",
            "CURRENT_USER_EVIDENCE_REQUIRED",
            "CURRENCY_REQUIRED",
            "CURRENCY_AMBIGUOUS",
            "CONSTRAINT_VALUE_NOT_EXPLICIT",
            "DESTINATION_EXCLUDED",
            "INVALID_TRAVEL_DATES",
          ];
          return {
            status: "rejected",
            evidence: "unavailable",
            code: "CONSTRAINT_CONFLICT",
            data: {
              reason:
                error instanceof Error && codes.includes(error.message)
                  ? error.message
                  : "INVALID_CONSTRAINT_CHANGE",
              ...(error instanceof ConstraintIssues
                ? {
                    fields: [
                      ...new Set(error.issues.map((issue) => issue.field)),
                    ],
                    issues: error.issues.map((issue) => ({
                      field: issue.field,
                      reason: issue.message,
                    })),
                    optionalFieldsToOmit: error.issues
                      .filter((issue) =>
                        [
                          "adults",
                          "children",
                          "budgetIncludesFlights",
                        ].includes(issue.field),
                      )
                      .map((issue) => issue.field),
                  }
                : error instanceof GroundingError
                  ? { fields: [error.field] }
                  : {}),
              correction:
                error instanceof GroundingError &&
                error.message === "CURRENCY_AMBIGUOUS"
                  ? "Currency is ambiguous. Ask which pound/dollar the user means; retain confirmed constraints and do not assume from dialect or locale."
                  : "Use the exact current-user span and its normalized value for the named field; preserve unchanged context. Magnitudes such as 30 ألف mean 30000 major units. Ask for clarification when the value is ambiguous.",
            },
          };
        }
      },
    });
  }
  registry.register({
    name: "search_company_packages",
    description:
      "Query the company database. If unavailable, explain that no company inventory is connected. Never invent prices or departures.",
    input: PackageQuery,
    output: ToolResult,
    timeoutMs: 6000,
    sideEffect: false,
    execute: async (raw, context) =>
      catalog.search(PackageQuery.parse(raw), context),
  });
  registry.register({
    name: "estimate_trip_budget",
    description:
      "Sum user-supplied or sourced estimated cost line items in integer currency minor units. Include assumptions and exclusions; not a quotation or live price.",
    input: BudgetInput,
    output: ToolResult,
    timeoutMs: 1000,
    sideEffect: false,
    execute: async (raw) => {
      const input = BudgetInput.parse(raw);
      const totalMinor = input.items.reduce(
        (total, item) => total + item.unitAmountMinor * item.quantity,
        0,
      );
      if (!Number.isSafeInteger(totalMinor))
        return {
          status: "rejected",
          evidence: "unavailable",
          code: "MONEY_OVERFLOW",
        };
      return {
        status: "ok",
        evidence: "estimated_itinerary",
        data: {
          label: "ESTIMATE",
          currency: input.currency,
          totalMinor,
          items: input.items,
          assumptions: input.assumptions,
          bookable: false,
        },
      };
    },
  });
  research?.register(registry);
  catalog.register?.(registry);
  return registry;
}
