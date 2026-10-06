import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_THEME, THEME_MANIFEST_FILE_NAME, THEMES_DIR_NAME } from './constants.js';

/** What a theme pack declares about itself in `theme.json` (every field optional). */
export interface ThemeManifest {
  /** Area label → furniture type shown beside an agent in that Area when its turn ends. */
  productsByArea: Record<string, string>;
  /** Teammate name (lower case) → Area label it is seated in. */
  roleAreas: Record<string, string>;
  /** Area a team lead is seated in. */
  leadArea?: string;
  /** Product type → sale price in bronze coins. */
  prices: Record<string, number>;
}

/** Keep only string → string entries of a loose JSON object. */
function stringMap(
  raw: unknown,
  normalizeKey: (key: string) => string = (k) => k,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[normalizeKey(key)] = value;
  }
  return out;
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
  const manifest: ThemeManifest = { productsByArea: {}, roleAreas: {}, prices: {} };
  const root = themeRoot(distRoot, theme);
  if (!root) return manifest;
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, THEME_MANIFEST_FILE_NAME), 'utf-8'),
    ) as Record<string, unknown>;
    manifest.productsByArea = stringMap(raw.productsByArea);
    manifest.roleAreas = stringMap(raw.roleAreas, (name) => name.toLowerCase());
    if (raw.prices && typeof raw.prices === 'object' && !Array.isArray(raw.prices)) {
      for (const [product, price] of Object.entries(raw.prices as Record<string, unknown>)) {
        if (typeof price === 'number' && Number.isInteger(price) && price >= 0) {
          manifest.prices[product] = price;
        }
      }
    }
    if (typeof raw.leadArea === 'string') manifest.leadArea = raw.leadArea;
  } catch {
    // Missing or malformed theme.json: the theme simply has no products or roles.
  }
  return manifest;
}

/** The crew the demo simulator plays in this theme (see FarmSimulator). */
export interface ThemeCrew {
  teamName: string;
  leadName: string;
  members: string[];
  chores: Record<string, string[]>;
}

const DEFAULT_CREW: ThemeCrew = {
  teamName: 'demo-team',
  leadName: 'lead',
  members: ['alex', 'blair', 'casey', 'drew', 'emery'],
  chores: {},
};

/**
 * The simulator's crew for a theme: the lead plus one member per role in
 * `roleAreas` (so each lands in its Area), with chore lines from theme.json's
 * `simulation` section. Themes without roles get a generic five-person crew.
 */
export function loadThemeCrew(distRoot: string, theme: string): ThemeCrew {
  const root = themeRoot(distRoot, theme);
  if (!root) return DEFAULT_CREW;
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, THEME_MANIFEST_FILE_NAME), 'utf-8'),
    ) as Record<string, unknown>;
    const sim = (raw.simulation ?? {}) as Record<string, unknown>;
    const members = Object.keys(stringMap(raw.roleAreas, (name) => name.toLowerCase()));
    const chores: Record<string, string[]> = {};
    if (sim.chores && typeof sim.chores === 'object' && !Array.isArray(sim.chores)) {
      for (const [name, lines] of Object.entries(sim.chores as Record<string, unknown>)) {
        if (Array.isArray(lines)) {
          const strings = lines.filter((l): l is string => typeof l === 'string');
          if (strings.length > 0) chores[name.toLowerCase()] = strings;
        }
      }
    }
    return {
      teamName: typeof sim.teamName === 'string' ? sim.teamName : DEFAULT_CREW.teamName,
      leadName:
        typeof sim.leadName === 'string' ? sim.leadName.toLowerCase() : DEFAULT_CREW.leadName,
      members: members.length > 0 ? members : DEFAULT_CREW.members,
      chores,
    };
  } catch {
    return DEFAULT_CREW;
  }
}
