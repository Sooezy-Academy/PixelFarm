/**
 * Builds the data file behind the static (serverless) demo — the Netlify site.
 *
 * A static host can't run the Pixel Agents server, so this runs the server's
 * own asset pipeline ONCE at build time — the theme pack layered over the
 * bundled assets, exactly as `buildAssetCache` does for a live server — and
 * records the handshake messages a server would send, plus the crew the
 * simulation plays. The static-demo transport replays them in the browser.
 *
 * Usage: tsx scripts/build-demo-snapshot.ts [theme] [outDir]
 *   theme   defaults to "farm"
 *   outDir  defaults to dist/webview (the built SPA)
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { STATIC_DEMO_SNAPSHOT_FILE } from '../core/src/constants.js';
import { buildAssetCache } from '../server/src/assetReload.js';
import { assetMessages, themeLoadedMessage } from '../server/src/clientMessageHandler.js';
import { claudeProvider } from '../server/src/providers/index.js';
import { loadThemeCrew, resolveTheme } from '../server/src/theme.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// webview-ui/public holds `assets/` (incl. assets/themes/<id>/): a valid asset root.
const ASSET_ROOT = path.join(ROOT, 'webview-ui', 'public');

async function main(): Promise<void> {
  const theme = resolveTheme(ASSET_ROOT, process.argv[2] ?? 'farm');
  const outDir = path.resolve(ROOT, process.argv[3] ?? 'dist/webview');
  const version = (
    JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version: string }
  ).version;
  const majorMinor = version.split('.').slice(0, 2).join('.');

  const cache = await buildAssetCache(ASSET_ROOT, [], theme);

  // The handshake, in the order handleWebviewReady sends it. No hooks consent
  // (nothing to install), no agents (the simulation brings them), and only this
  // theme on offer (a static build can't switch).
  const messages: Array<Record<string, unknown>> = [
    {
      type: 'providerCapabilities',
      readingTools: [...claudeProvider.readingTools],
      subagentToolNames: [...claudeProvider.subagentToolNames],
    },
    ...assetMessages(cache),
    {
      type: 'settingsLoaded',
      soundEnabled: false,
      // Seen already, so no "what's new" popup greets demo visitors.
      lastSeenVersion: majorMinor,
      extensionVersion: version,
      watchAllSessions: false,
      alwaysShowLabels: false,
      ghostHeadlessAgents: false,
      hooksEnabled: false,
      hooksInfoShown: true,
      externalAssetDirectories: [],
      showAreas: false,
    },
    { ...themeLoadedMessage(cache), themes: [theme] },
    { type: 'areaMappingsLoaded', mappings: {} },
    { type: 'existingAgents', agents: [], agentMeta: {}, folderNames: {}, externalAgents: {} },
    { type: 'layoutLoaded', layout: cache.defaultLayout },
  ];

  const snapshot = { theme, crew: loadThemeCrew(ASSET_ROOT, theme), messages };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, STATIC_DEMO_SNAPSHOT_FILE);
  fs.writeFileSync(file, JSON.stringify(snapshot));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(
    `[demo-snapshot] ${theme}: ${messages.length} messages → ${path.relative(ROOT, file)} (${kb} KB)`,
  );
}

main().catch((err: unknown) => {
  console.error('[demo-snapshot] failed:', err);
  process.exit(1);
});
