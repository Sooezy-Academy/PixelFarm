import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_THEME, THEME_MANIFEST_FILE_NAME, THEMES_DIR_NAME } from './constants.js';

/** What a theme pack declares about itself in `theme.json` (every field optional). */
export interface ThemeManifest {
  /** Area label → furniture type shown beside an agent in that Area when its turn ends. */
  productsByArea: Record<string, string>;
}

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function themesDir(distRoot: string): string {
  return path.join(distRoot, 'assets', THEMES_DIR_NAME);
}

/**
 * The asset root of a non-default theme, shaped like any other asset root
 * (`<root>/assets/furniture`, `<root>/assets/pets`, ...), or null for the
 * default theme and for ids that don't name a bundled pack.
 */
export function themeRoot(distRoot: string, theme: string): string | null {
  if (theme === DEFAULT_THEME || !THEME_ID_PATTERN.test(theme)) return null;
  const root = path.join(themesDir(distRoot), theme);
  return fs.existsSync(path.join(root, 'assets')) ? root : null;
}

/** Every theme this build can switch to: the default first, then bundled packs alphabetically. */
export function listThemes(distRoot: string): string[] {
  const themes = [DEFAULT_THEME];
  try {
    for (const entry of fs.readdirSync(themesDir(distRoot)).sort()) {
      if (entry !== DEFAULT_THEME && themeRoot(distRoot, entry)) themes.push(entry);
    }
  } catch {
    // No themes directory: only the default theme exists.
  }
  return themes;
}

/** A persisted or requested theme id, falling back to the default when no such pack is bundled. */
export function resolveTheme(distRoot: string, theme: unknown): string {
  return typeof theme === 'string' && themeRoot(distRoot, theme) ? theme : DEFAULT_THEME;
}

export function loadThemeManifest(distRoot: string, theme: string): ThemeManifest {
  const manifest: ThemeManifest = { productsByArea: {} };
  const root = themeRoot(distRoot, theme);
  if (!root) return manifest;
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, THEME_MANIFEST_FILE_NAME), 'utf-8'),
    ) as Record<string, unknown>;
    const products = raw.productsByArea;
    if (products && typeof products === 'object' && !Array.isArray(products)) {
      for (const [area, type] of Object.entries(products)) {
        if (typeof type === 'string') manifest.productsByArea[area] = type;
      }
    }
  } catch {
    // Missing or malformed theme.json: the theme simply has no products.
  }
  return manifest;
}
