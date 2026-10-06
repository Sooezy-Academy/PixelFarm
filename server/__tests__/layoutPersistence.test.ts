import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getLayoutFilePath,
  loadLayout,
  readLayoutFromFile,
  setLayoutTheme,
  writeLayoutToFile,
} from '../src/layoutPersistence.js';

describe('layoutPersistence: one layout file per theme', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-layout-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    setLayoutTheme('office');
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('keeps layout.json for the default theme and layout-<theme>.json for others', () => {
    expect(getLayoutFilePath('office')).toBe(path.join(tempHome, '.pixel-agents', 'layout.json'));
    expect(getLayoutFilePath('farm')).toBe(
      path.join(tempHome, '.pixel-agents', 'layout-farm.json'),
    );
  });

  it('never lets one theme overwrite the other', () => {
    writeLayoutToFile({ version: 1, marker: 'office' });
    setLayoutTheme('farm');
    expect(readLayoutFromFile()).toBeNull();
    writeLayoutToFile({ version: 1, marker: 'farm' });

    expect(readLayoutFromFile()).toEqual({ version: 1, marker: 'farm' });
    setLayoutTheme('office');
    expect(readLayoutFromFile()).toEqual({ version: 1, marker: 'office' });
  });

  it("seeds a theme's file from that theme's default on first load", () => {
    writeLayoutToFile({ version: 1, marker: 'office' });
    setLayoutTheme('farm');

    const result = loadLayout({ version: 1, marker: 'farm-default' });

    expect(result?.layout).toEqual({ version: 1, marker: 'farm-default' });
    expect(fs.existsSync(getLayoutFilePath('farm'))).toBe(true);
    expect(readLayoutFromFile()).toEqual({ version: 1, marker: 'farm-default' });
    setLayoutTheme('office');
    expect(readLayoutFromFile()).toEqual({ version: 1, marker: 'office' });
  });
});
