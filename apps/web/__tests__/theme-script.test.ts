import { describe, expect, it, vi } from 'vitest';
import { applyInitialTheme, INITIAL_THEME_SCRIPT } from '../lib/theme-script';

describe('INITIAL_THEME_SCRIPT', () => {
  it('is a self-contained IIFE that applies the dark class', () => {
    expect(INITIAL_THEME_SCRIPT).toContain('matchMedia');
    expect(INITIAL_THEME_SCRIPT).toContain("classList.add('dark')");
    expect(INITIAL_THEME_SCRIPT).toContain('catch');
  });
});

function makeWindow(
  overrides: {
    matches?: boolean;
    throwMatchMedia?: boolean;
  } = {}
) {
  const classList: string[] = [];
  const classListMock = {
    add: (className: string) => {
      if (!classList.includes(className)) classList.push(className);
    },
    contains: (className: string) => classList.includes(className),
  };
  const matchMedia = vi.fn((query: string) => {
    if (overrides.throwMatchMedia) {
      throw new Error('matchMedia is not supported');
    }
    return { matches: overrides.matches ?? false };
  });
  const win = {
    document: {
      documentElement: {
        classList: classListMock,
      },
    },
    matchMedia,
  } as unknown as Window;
  return { win, classList: classListMock, matchMedia };
}

describe('applyInitialTheme', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds the dark class when the color scheme prefers dark', () => {
    const { win, classList } = makeWindow({ matches: true });
    applyInitialTheme(win);
    expect(classList.contains('dark')).toBe(true);
  });

  it('does not add the dark class when the color scheme prefers light', () => {
    const { win, classList } = makeWindow({ matches: false });
    applyInitialTheme(win);
    expect(classList.contains('dark')).toBe(false);
  });

  it('tolerates matchMedia throwing and leaves the class unchanged', () => {
    const { win, classList } = makeWindow({
      matches: true,
      throwMatchMedia: true,
    });
    expect(() => applyInitialTheme(win)).not.toThrow();
    expect(classList.contains('dark')).toBe(false);
  });
});
