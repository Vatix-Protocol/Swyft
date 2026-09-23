import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style of the button. Defaults to 'primary'. */
  variant?: ButtonVariant;
  /** Size preset. Defaults to 'md'. */
  size?: ButtonSize;
  /** When true the button is replaced by a loading spinner and becomes non-interactive. */
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-500 disabled:bg-indigo-300 dark:disabled:bg-indigo-800',
  secondary:
    'bg-white text-zinc-900 ring-1 ring-zinc-200 hover:ring-indigo-400 focus-visible:ring-indigo-500 dark:bg-zinc-800 dark:text-white dark:ring-zinc-600 dark:hover:ring-indigo-400',
  ghost:
    'bg-transparent text-zinc-700 hover:bg-zinc-100 focus-visible:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800',
  danger:
    'bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500 disabled:bg-red-300 dark:disabled:bg-red-800',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs min-h-[32px]',
  md: 'px-4 py-2 text-sm min-h-[40px]',
  lg: 'px-5 py-2.5 text-base min-h-[48px]',
};

/**
 * Shared Button primitive exported from @swyft/ui.
 *
 * Supports four variants (primary, secondary, ghost, danger), three sizes,
 * a loading state, full keyboard accessibility, and dark mode.
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="md" onClick={handleSwap}>
 *   Swap
 * </Button>
 * ```
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-busy={loading}
      aria-disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold',
        'transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {loading ? (
        <>
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <span className="sr-only">Loading…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
