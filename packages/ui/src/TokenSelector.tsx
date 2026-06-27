'use client';

import { Token } from './types';
import { TokenSelectorModal } from './TokenSelectorModal';

export interface TokenSelectorProps {
  /** Full list of tokens available for selection. */
  tokens: Token[];
  /** The currently selected token, or null if none is selected. */
  selected: Token | null;
  /**
   * Called when the user selects a token.
   * The modal closes automatically after selection.
   */
  onSelect: (token: Token) => void;
  /**
   * Accessible label for the trigger button and dialog title.
   * Example: "Input token" or "Output token".
   */
  label: string;
  /**
   * When true, shows a loading spinner inside the modal and disables
   * the trigger button and search input.
   */
  loading?: boolean;
  /** Map of token ID → formatted balance string shown next to each token. */
  balances?: Record<string, string>;
  /** Ordered list of recently used token IDs shown at the top of the list. */
  recentIds?: string[];
}

/**
 * Thin wrapper around {@link TokenSelectorModal} that provides a named
 * `TokenSelector` export for consumers who prefer the shorter name.
 *
 * Includes full loading state: spinner inside the modal, disabled trigger
 * button, and disabled search input while `loading` is true.
 *
 * @example
 * ```tsx
 * <TokenSelector
 *   label="Input token"
 *   tokens={tokens}
 *   selected={selectedToken}
 *   loading={isLoadingTokens}
 *   onSelect={setSelectedToken}
 * />
 * ```
 */
export function TokenSelector(props: TokenSelectorProps) {
  return <TokenSelectorModal {...props} />;
}
