export type Theme = 'light' | 'dark';

interface ThemeEnvironment {
  /** Returns the storage to use; may throw (blocked site data). */
  storage: () => Pick<Storage, 'getItem' | 'setItem'>;
  prefersDark: () => boolean;
  root: HTMLElement;
}

/**
 * Light/dark theme: the stored choice, else the system preference. The `.dark` class on <html> switches
 * the CSS tokens. index.html runs the same lookup before first paint, so a reload never flashes.
 * Storage failures are ignored: the theme then simply is not remembered.
 */
export class ThemeController {
  static readonly STORAGE_KEY = 'inv.theme';

  constructor(private readonly env: ThemeEnvironment) {}

  static forDocument(): ThemeController {
    return new ThemeController({
      storage: () => window.localStorage,
      prefersDark: () => window.matchMedia('(prefers-color-scheme: dark)').matches,
      root: document.documentElement,
    });
  }

  current(): Theme {
    return this.stored() ?? (this.env.prefersDark() ? 'dark' : 'light');
  }

  /** Shows `theme` and remembers it. */
  set(theme: Theme): void {
    this.env.root.classList.toggle('dark', theme === 'dark');
    try {
      this.env.storage().setItem(ThemeController.STORAGE_KEY, theme);
    } catch {
      // Not remembered; the theme still applies for this page view.
    }
  }

  toggle(): Theme {
    const next: Theme = this.current() === 'dark' ? 'light' : 'dark';
    this.set(next);
    return next;
  }

  private stored(): Theme | null {
    try {
      const value = this.env.storage().getItem(ThemeController.STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }
}
