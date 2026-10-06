import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  listThemes,
  loadThemeCrew,
  loadThemeManifest,
  resolveTheme,
  themeRoot,
} from '../src/theme.js';

describe('theme packs', () => {
  let dist: string;

  /** Create `<dist>/assets/themes/<id>/` (with an `assets/` dir unless told otherwise). */
  function addTheme(id: string, opts: { withAssets?: boolean; manifest?: string } = {}): string {
    const root = path.join(dist, 'assets', 'themes', id);
    fs.mkdirSync(opts.withAssets === false ? root : path.join(root, 'assets'), { recursive: true });
    if (opts.manifest !== undefined) fs.writeFileSync(path.join(root, 'theme.json'), opts.manifest);
    return root;
  }

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-theme-test-'));
  });

  afterEach(() => {
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('offers only the default theme when no packs are bundled', () => {
    expect(listThemes(dist)).toEqual(['office']);
  });

  it('lists the default first, then bundled packs alphabetically', () => {
    addTheme('space');
    addTheme('farm');
    expect(listThemes(dist)).toEqual(['office', 'farm', 'space']);
  });

  it('ignores directories that are not packs: no assets/, an invalid id, or one named like the default', () => {
    addTheme('empty', { withAssets: false });
    addTheme('Bad Name');
    addTheme('office');
    expect(listThemes(dist)).toEqual(['office']);
  });

  it('resolves only ids that name a bundled pack, falling back to the default otherwise', () => {
    addTheme('farm');
    expect(resolveTheme(dist, 'farm')).toBe('farm');
    expect(resolveTheme(dist, 'office')).toBe('office');
    expect(resolveTheme(dist, 'castle')).toBe('office');
    expect(resolveTheme(dist, '../farm')).toBe('office');
    expect(resolveTheme(dist, 42)).toBe('office');
    expect(resolveTheme(dist, undefined)).toBe('office');
  });

  it('has no theme root for the default theme', () => {
    expect(themeRoot(dist, 'office')).toBeNull();
  });

  it('reads productsByArea from theme.json, dropping non-string entries', () => {
    addTheme('farm', {
      manifest: JSON.stringify({ productsByArea: { 'Hen house': 'EGG_BASKET', Field: 7 } }),
    });
    expect(loadThemeManifest(dist, 'farm')).toEqual({
      productsByArea: { 'Hen house': 'EGG_BASKET' },
      roleAreas: {},
    });
  });

  it('treats a missing or malformed theme.json as a theme without products', () => {
    addTheme('farm', { manifest: '{ not json' });
    addTheme('plain');
    const none = { productsByArea: {}, roleAreas: {} };
    expect(loadThemeManifest(dist, 'farm')).toEqual(none);
    expect(loadThemeManifest(dist, 'plain')).toEqual(none);
    expect(loadThemeManifest(dist, 'office')).toEqual(none);
  });

  it('reads team roles: teammate names (case-folded) to Areas, and the lead Area', () => {
    addTheme('farm', {
      manifest: JSON.stringify({
        leadArea: 'Farmhouse',
        roleAreas: { Hens: 'Hen house', cows: 'Cow barn', bad: 3 },
      }),
    });
    expect(loadThemeManifest(dist, 'farm')).toEqual({
      productsByArea: {},
      roleAreas: { hens: 'Hen house', cows: 'Cow barn' },
      leadArea: 'Farmhouse',
    });
  });

  it('builds the simulated crew from the roles and the simulation section', () => {
    addTheme('farm', {
      manifest: JSON.stringify({
        roleAreas: { Hens: 'Hen house', cows: 'Cow barn' },
        simulation: {
          teamName: 'farm-team',
          leadName: 'Manager',
          chores: { manager: ['Planning the day'], HENS: ['Collecting eggs', 7], cows: [] },
        },
      }),
    });
    expect(loadThemeCrew(dist, 'farm')).toEqual({
      teamName: 'farm-team',
      leadName: 'manager',
      members: ['hens', 'cows'],
      chores: { manager: ['Planning the day'], hens: ['Collecting eggs'] },
    });
  });

  it('gives themes without roles a generic five-person crew', () => {
    addTheme('plain');
    for (const theme of ['plain', 'office']) {
      const crew = loadThemeCrew(dist, theme);
      expect(crew.members).toHaveLength(5);
      expect(crew.chores).toEqual({});
    }
  });
});
