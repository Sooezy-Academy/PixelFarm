import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '../../fixtures/standalone';
import type { TestHooksWindow } from '../../helpers/editor';
import { openSettingsModal } from '../../helpers/webview';

const THEME_SWITCH_TIMEOUT_MS = 15_000;

/** Labels of the Areas in the layout the office is currently showing. */
async function areaLabels(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() =>
    ((window as TestHooksWindow).__pixelAgentsTestHooks?.getAreas?.() ?? []).map((a) => a.label),
  );
}

test.describe('Standalone / themes', () => {
  test('switching to the farm theme loads its own layout and back again @area:standalone', async ({
    page,
    standalone,
  }) => {
    const settings = await openSettingsModal(page);
    const themeRow = settings.locator('button', { hasText: 'Theme' });
    await expect(themeRow).toContainText('Office');
    await standalone.drainMessages();

    await themeRow.click();

    await expect(themeRow).toContainText('Farm', { timeout: THEME_SWITCH_TIMEOUT_MS });
    await expect
      .poll(() => areaLabels(page), { timeout: THEME_SWITCH_TIMEOUT_MS })
      .toEqual(['Hen house', 'Cow barn', 'Field', 'Silo yard', 'Market']);
    const switchMessages = await standalone.drainMessages();
    const types = switchMessages.map((m) => m.type);
    expect(types).toContain('themeLoaded');
    expect(types.indexOf('themeLoaded')).toBeLessThan(types.lastIndexOf('layoutLoaded'));

    // The choice is persisted for this surface only.
    const config = JSON.parse(
      fs.readFileSync(path.join(standalone.tmpHome, '.pixel-agents', 'config.json'), 'utf-8'),
    ) as { standalone: { theme: string }; vscode: { theme: string } };
    expect(config.standalone.theme).toBe('farm');
    expect(config.vscode.theme).toBe('office');

    await themeRow.click();

    await expect(themeRow).toContainText('Office', { timeout: THEME_SWITCH_TIMEOUT_MS });
    await expect
      .poll(() => areaLabels(page), { timeout: THEME_SWITCH_TIMEOUT_MS })
      .not.toContain('Hen house');
  });
});
