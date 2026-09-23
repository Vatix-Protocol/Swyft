import React from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Label rendered above the input. Also sets `aria-label` when no explicit one is provided. */
  label?: string;
  /** Helper or validation message rendered below the input. */
  hint?: string;
  /** When true the hint is styled as an error. */
  error?: boolean;
  /** Size preset. Defaults to 'md'. */
  size?: InputSize;
  /** Optional leading icon/element rendered inside the left edge of the input. */
  leadingIcon?: React.ReactNode;
  /** Optional trailing icon/element rendered inside the right edge of the input. */
  trailingIcon?: React.ReactNode;
}

const sizeClasses: Record<InputSize, { input: string; label: string }> = {
  sm: { input: 'px-3 py-1.5 text-xs min-h-[32px]', label: 'text-xs' },
  md: { input: 'px-3 py-2 text-sm min-h-[40px]', label: 'text-xs' },
  lg: { input: 'px-4 py-2.5 text-base min-h-[48px]', label: 'text-sm' },
};

/**
 * Shared Input primitive exported from @swyft/ui.
 *
 * Wraps a native `<input>` with consistent styling, dark-mode support,
 * optional label, hint/error text, and leading/trailing icon slots.
 *
 * @example
 * ```tsx
 * <Input
 *   label="Slippage tolerance"
 *   placeholder="0.5"
 *   hint="Max 50%"
 *   error={value > 50}
 * />
 * ```
 */
export function Input({
  label,
  hint,
  error = false,
  size = 'md',
  leadingIcon,
  trailingIcon,
  id,
  className = '',
  disabled,
  ...props
}: InputProps) {
  // Generate a stable id when one is not provided so the label stays associated.
  const inputId = id ?? (label ? `swyft-input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  const borderClass = error
    ? 'border-red-400 dark:border-red-500 focus-within:ring-red-400'
    : 'border-zinc-200 dark:border-zinc-700 focus-within:ring-indigo-400';

  const { input: inputSizeClass, label: labelSizeClass } = sizeClasses[size];

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className={`font-medium text-zinc-700 dark:text-zinc-300 ${labelSizeClass}`}
        >
          {label}
        </label>
      )}

      <div
        className={[
          'flex items-center gap-2 rounded-xl border bg-zinc-50 transition-colors',
          'focus-within:ring-2 focus-within:ring-offset-0',
          'dark:bg-zinc-800',
          disabled ? 'cursor-not-allowed opacity-60' : '',
          borderClass,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {leadingIcon && (
          <span className="pl-3 text-zinc-400 dark:text-zinc-500" aria-hidden="true">
            {leadingIcon}
          </span>
        )}

        <input
          id={inputId}
          disabled={disabled}
          aria-label={props['aria-label'] ?? label}
          aria-invalid={error}
          aria-describedby={hint ? `${inputId}-hint` : undefined}
          className={[
            'flex-1 bg-transparent text-zinc-900 placeholder-zinc-400',
            'focus:outline-none',
            'dark:text-white dark:placeholder-zinc-600',
            'disabled:cursor-not-allowed',
            trailingIcon ? '' : 'pr-3',
            leadingIcon ? '' : 'pl-3',
            inputSizeClass,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        />

        {trailingIcon && (
          <span className="pr-3 text-zinc-400 dark:text-zinc-500" aria-hidden="true">
            {trailingIcon}
          </span>
        )}
      </div>

      {hint && (
        <p
          id={`${inputId}-hint`}
          className={`text-xs ${error ? 'text-red-500 dark:text-red-400' : 'text-zinc-400 dark:text-zinc-500'}`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
