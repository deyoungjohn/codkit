import type { Decision, SimulationResult } from "./types.js";

export type PolicyErrorCode =
  | "denied"
  | "approval_rejected"
  | "simulation_required"
  | "simulation_failed"
  | "killed";

/** Thrown whenever the engine refuses to let an action through. */
export class PolicyError extends Error {
  override readonly name = "PolicyError";

  constructor(
    readonly code: PolicyErrorCode,
    message: string,
    readonly decision?: Decision,
    readonly simulation?: SimulationResult,
  ) {
    super(message);
  }
}

export const isPolicyError = (e: unknown): e is PolicyError => e instanceof PolicyError;
