import type { PolicyEvent } from "@iamyoungjohn-kit/policy";
import type { ReceiptLog } from "./log.js";
import type { Receipt } from "./types.js";

export interface PolicyRecorderOptions {
  /** Which policy events to record. Default: all. */
  include?: PolicyEvent["type"][];
  onError?: (error: unknown) => void;
}

export interface PolicyRecorder {
  stop(): void;
  /** Resolves once every event seen so far has been written. */
  flush(): Promise<void>;
}

/**
 * Write every policy-engine event (decision, approval, simulation, executed,
 * failed, committed, released, kill switch) to the receipt log as
 * `policy.<event>`. This is the agent's verifiable audit trail.
 */
export function recordPolicyEvents(
  engine: { on(listener: (e: PolicyEvent) => void): () => void },
  log: ReceiptLog,
  opts: PolicyRecorderOptions = {},
): PolicyRecorder {
  let pending: Promise<unknown> = Promise.resolve();
  const off = engine.on((event) => {
    if (opts.include && !opts.include.includes(event.type)) return;
    const { type, ...data } = event;
    const write: Promise<Receipt | void> = log.append(`policy.${type}`, data).catch((e: unknown) => opts.onError?.(e));
    pending = pending.then(() => write);
  });
  return {
    stop: off,
    flush: () => pending.then(() => undefined),
  };
}
