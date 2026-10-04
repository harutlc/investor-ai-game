import { useCallback, useState } from 'react';
import { ThemeController, type Theme } from '@/lib/ThemeController';

let controller: ThemeController | null = null;
const getController = () => (controller ??= ThemeController.forDocument());

/** The current theme and a toggle that applies and remembers the other one. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => getController().current());
  const toggle = useCallback(() => setTheme(getController().toggle()), []);
  return { theme, toggle };
}
