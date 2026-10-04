import { describe, expect, it } from 'vitest';
import { ThemeController } from '@/lib/ThemeController';

function controller(
  options: { prefersDark?: boolean; storage?: () => Pick<Storage, 'getItem' | 'setItem'> } = {},
) {
  const root = document.createElement('html');
  const map = new Map<string, string>();
  const storage =
    options.storage ??
    (() => ({
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    }));
  return {
    root,
    map,
    theme: new ThemeController({ storage, prefersDark: () => options.prefersDark ?? false, root }),
  };
}

describe('ThemeController', () => {
  it('follows the system preference when nothing is stored', () => {
    expect(controller({ prefersDark: true }).theme.current()).toBe('dark');
    expect(controller({ prefersDark: false }).theme.current()).toBe('light');
  });

  it('persists a toggle and applies the class', () => {
    const { theme, root, map } = controller();
    expect(theme.toggle()).toBe('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(map.get('inv.theme')).toBe('dark');
    expect(theme.current()).toBe('dark');
    expect(theme.toggle()).toBe('light');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('survives a throwing localStorage', () => {
    const { theme, root } = controller({
      prefersDark: true,
      storage: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(theme.current()).toBe('dark');
    expect(theme.toggle()).toBe('light');
    expect(root.classList.contains('dark')).toBe(false);
  });
});
