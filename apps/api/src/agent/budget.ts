import { SafeError } from "../errors.js";
export type TurnBudgetReason =
  | "turn_timeout"
  | "context_capacity"
  | "token_capacity"
  | "tool_rounds"
  | "tool_calls";
export class TurnBudgetError extends SafeError {
  constructor(readonly reason: TurnBudgetReason) {
    super("TURN_BUDGET");
  }
}
