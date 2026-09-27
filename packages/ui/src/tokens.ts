/**
 * @swyft/ui — Design Tokens
 *
 * Single source of truth for colours, radii, spacing, typography, and
 * animation values used across every component in this package.
 *
 * INVARIANTS
 * ──────────
 * - All values are plain TypeScript constants so they are tree-shaken when
 *   unused and carry no runtime overhead.
 * - Tailwind class strings are derived from these tokens via the helpers
 *   exported at the bottom of this file; no component hard-codes a raw Hex or
 *   pixel value directly.
 * - Token names follow the pattern: `<category>.<scale|purpose>`.
 * - Dark-mode variants are expressed as Tailwind `dark:` prefixes so a single
 *   token covers both themes.
 */

// ── Colour palette ────────────────────────────────────────────────────────────

/** Brand indigo — primary interactive colour. */
export const colorBrand = {
  50: '#eef2ff',
  100: '#e0e7ff',
  200: '#c7d2fe',
  300: '#a5b4fc',
  400: '#818cf8',
  500: '#6366f1',
  600: '#4f46e5',
  700: '#4338ca',
  800: '#3730a3',
  900: '#312e81',
} as const;

/** Neutral zinc — surfaces, borders, and text. */
export const colorNeutral = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  950: '#09090b',
} as const;

/** Semantic status colours. */
export const colorStatus = {
  success: '#22c55e', // green-500
  successSubtle: '#dcfce7', // green-100
  successText: '#15803d', // green-700
  warning: '#eab308', // yellow-500
  warningSubtle: '#fef9c3', // yellow-100
  warningText: '#a16207', // yellow-700
  danger: '#ef4444', // red-500
  dangerSubtle: '#fee2e2', // red-100
  dangerText: '#b91c1c', // red-700
  info: '#6366f1', // brand-500
  infoSubtle: '#eef2ff', // brand-50
  infoText: '#4338ca', // brand-700
} as const;

// ── Spacing scale ─────────────────────────────────────────────────────────────
// Values mirror Tailwind's default 4-point grid (1 unit = 4 px).

export const spacing = {
  0: '0px',
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  2.5: '10px',
  3: '12px',
  3.5: '14px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  10: '40px',
  12: '48px',
  14: '56px',
  16: '64px',
} as const;

// ── Border radius ─────────────────────────────────────────────────────────────

export const radius = {
  /** Tiny: checkboxes, very small tags. */
  sm: '4px',
  /** Default: inputs, dropdowns, tooltips. */
  md: '8px',
  /** Cards, panels, modals. */
  lg: '12px',
  /** Hero cards, large sheet panels. */
  xl: '16px',
  /** 2xl: bottom sheets, full-bleed cards. */
  '2xl': '24px',
  /** Full pill: badges, chips, toggle buttons. */
  full: '9999px',
} as const;

// ── Typography ────────────────────────────────────────────────────────────────

export const fontSize = {
  xs: ['12px', { lineHeight: '16px' }],
  sm: ['14px', { lineHeight: '20px' }],
  base: ['16px', { lineHeight: '24px' }],
  lg: ['18px', { lineHeight: '28px' }],
  xl: ['20px', { lineHeight: '28px' }],
  '2xl': ['24px', { lineHeight: '32px' }],
  '3xl': ['30px', { lineHeight: '36px' }],
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const fontFamily = {
  /** Primary sans-serif — matches Geist loaded in apps/web/app/layout.tsx. */
  sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  /** Monospace — used for addresses, amounts, and numeric readouts. */
  mono: ['Geist Mono', 'ui-monospace', 'monospace'],
} as const;

// ── Elevation / shadow ────────────────────────────────────────────────────────

export const shadow = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.07), 0 4px 6px -4px rgb(0 0 0 / 0.05)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.07), 0 8px 10px -6px rgb(0 0 0 / 0.05)',
} as const;

// ── Z-index scale ─────────────────────────────────────────────────────────────

export const zIndex = {
  base: 0,
  raised: 10,
  dropdown: 20,
  sticky: 30,
  overlay: 40,
  modal: 50,
  toast: 60,
  tooltip: 70,
} as const;

// ── Animation ─────────────────────────────────────────────────────────────────

export const duration = {
  fast: '100ms',
  base: '150ms',
  slow: '250ms',
  slower: '400ms',
} as const;

export const easing = {
  /** Default ease-in-out for UI transitions. */
  default: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Ease-out — elements entering the screen. */
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  /** Ease-in — elements leaving the screen. */
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

// ── Component-level tokens ────────────────────────────────────────────────────
// These map semantic intent onto the primitive tokens above and are consumed
// directly by component implementations.

/** Minimum touch-target dimensions (WCAG 2.5.5 / Apple HIG). */
export const touchTarget = {
  min: '44px',
} as const;

/** Focus ring shared across all interactive elements. */
export const focusRing = {
  width: '2px',
  offset: '2px',
  color: colorBrand[500],
} as const;

/** Button size map — used by Button.tsx. */
export const buttonSize = {
  sm: {
    paddingX: spacing[3],
    paddingY: spacing[1.5],
    fontSize: fontSize.xs[0],
    minHeight: '32px',
  },
  md: {
    paddingX: spacing[4],
    paddingY: spacing[2],
    fontSize: fontSize.sm[0],
    minHeight: '40px',
  },
  lg: {
    paddingX: spacing[5],
    paddingY: spacing[2.5],
    fontSize: fontSize.base[0],
    minHeight: '48px',
  },
} as const;

/**
 * Tailwind utility class fragments derived from tokens.
 *
 * Components should consume these helpers so a token change propagates
 * automatically without grep-based refactoring.
 */
export const tw = {
  focusRing: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500',
  transition: 'transition-all duration-150',
  card: 'rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900',
  cardPadding: 'p-4',
  badge: {
    success: 'inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400',
    warning: 'inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
    danger:  'inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400',
    neutral: 'inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  },
} as const;
