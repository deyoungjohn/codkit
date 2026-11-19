import { useEffect, useId, useState } from "react";
import { cx } from "./AddressPill.js";
import { formatAmount, parseAmount } from "./units.js";

export interface TokenAmountInputProps {
  /** Atomic units (e.g. 1_500_000n for 1.5 USDC). */
  value: bigint | undefined;
  /** Called with atomic units, or `undefined` while the text isn't a valid amount. */
  onChange: (value: bigint | undefined) => void;
  decimals: number;
  symbol?: string;
  /** Shows a Max button and flags amounts above it. */
  max?: bigint;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** Decimal text in, exact bigint out: never loses precision to floats, rejects too many decimals. */
export function TokenAmountInput({ value, onChange, decimals, symbol, max, label = "Amount", disabled, className }: TokenAmountInputProps) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? "" : formatAmount(value, decimals));
  // Follow outside changes (a reset, Max elsewhere) but never fight the user's typing: only rewrite the
  // text when it no longer parses to `value` ("1." and "1.0" both stay as typed for 1n).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` is read, not a trigger
  useEffect(() => {
    if (parseAmount(text, decimals) !== value) setText(value === undefined ? "" : formatAmount(value, decimals));
  }, [value, decimals]);

  const parsed = parseAmount(text, decimals);
  const invalid = text.trim() !== "" && parsed === undefined;
  const tooMuch = parsed !== undefined && max !== undefined && parsed > max;
  const error = invalid
    ? `Enter a number with at most ${decimals} decimals`
    : tooMuch
      ? `More than the ${formatAmount(max!, decimals)} available`
      : undefined;

  return (
    <div className={cx("ck-amount", className)}>
      <label htmlFor={id}>{label}</label>
      <div className="ck-amount-row">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={text}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            const next = e.target.value.replace(",", ".");
            if (!/^\d*\.?\d*$/.test(next)) return;
            setText(next);
            onChange(parseAmount(next, decimals));
          }}
        />
        {symbol && <span className="ck-muted">{symbol}</span>}
        {max !== undefined && (
          <button
            type="button"
            className="ck-ghost"
            disabled={disabled}
            onClick={() => {
              setText(formatAmount(max, decimals));
              onChange(max);
            }}
          >
            Max
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="ck-error">
          {error}
        </p>
      )}
    </div>
  );
}
