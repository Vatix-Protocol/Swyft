/**
 * theme-script.ts — behaviour of the inline pre-paint script injected by
 * RootLayout, extracted so it can be unit tested and kept in sync with any
 * CSP hash/nonce that covers the inline script.
 *
 * The script applies the `dark` class to the root element before first paint
 * when the user prefers a dark colour scheme, preventing a flash of light
 * content. It tolerates `matchMedia` throwing (e.g. in older browsers or test
 * environments) and leaves the class unchanged in that case.
 */

/**
 * Source of the inline `<script>` rendered by RootLayout. Self-contained IIFE
 * that runs `applyInitialTheme` against the browser `window`.
 */
export const INITIAL_THEME_SCRIPT = `(function(){try{if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark');}}catch(e){}})();`;

/**
 * applyInitialTheme() — the runtime behaviour of INITIAL_THEME_SCRIPT,
 * extracted so it can be unit tested against a mocked window.
 *
 * @param win - window-like object providing matchMedia and document.
 */
export function applyInitialTheme(win: Window): void {
  try {
    if (win.matchMedia('(prefers-color-scheme: dark)').matches) {
      win.document.documentElement.classList.add('dark');
    }
  } catch {
    // Tolerate matchMedia throwing; leave the class unchanged.
  }
}
