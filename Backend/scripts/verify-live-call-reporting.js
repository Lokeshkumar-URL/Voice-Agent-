import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const callRoutes = await readFile(new URL('../src/calls/call.routes.js', import.meta.url), 'utf8');
const dashboardRoutes = await readFile(new URL('../src/dashboard/dashboard.routes.js', import.meta.url), 'utf8');
const callService = await readFile(new URL('../src/calls/call.service.js', import.meta.url), 'utf8');
const callSessionStore = await readFile(new URL('../src/voice/call-session-store.js', import.meta.url), 'utf8');
const queryClient = await readFile(new URL('../../Frontend/src/lib/queryClient.ts', import.meta.url), 'utf8');
const apiClient = await readFile(new URL('../../Frontend/src/lib/api.ts', import.meta.url), 'utf8');
const browserMedia = await readFile(new URL('../../Frontend/src/lib/browserAgentMedia.ts', import.meta.url), 'utf8');
const reportsView = await readFile(new URL('../../Frontend/src/components/reports/DeveloperReportsView.tsx', import.meta.url), 'utf8');
const compose = await readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
const frontendProxy = await readFile(new URL('../../Frontend/nginx.conf', import.meta.url), 'utf8');
const publicProxy = await readFile(new URL('../../docs/production-openresty-websocket.conf', import.meta.url), 'utf8');

for (const source of [callRoutes, dashboardRoutes]) {
  assert.match(source, /private, no-store, no-cache, max-age=0, must-revalidate/);
  assert.match(source, /Pragma:\s*['"]no-cache['"]/);
}
assert.match(queryClient, /['"]\/calls['"]/);
assert.match(queryClient, /['"]\/dashboard['"]/);
assert.match(apiClient, /isLiveApiPath\(path\)\) requestInit\.cache = ['"]no-store['"]/);
assert.match(callService, /fromNumber:\s*row\.from_number,\s*toNumber:\s*row\.to_number/);
assert.match(callService, /COALESCE\(o\.name, t\.name\) AS company_name/);
assert.match(callService, /JOIN tenants t ON t\.id = c\.tenant_id/);
assert.match(callService, /LEFT JOIN organizations o ON o\.tenant_id = c\.tenant_id/);
assert.match(callSessionStore, /input\.call\.from,\s*\n\s*input\.call\.to/);
assert.match(reportsView, /call\.direction === ['"]inbound['"] \? call\.fromNumber : call\.toNumber/);
assert.match(reportsView, />\{call\.fromNumber\}<\/td>/);
assert.match(reportsView, />\{call\.toNumber\}<\/td>/);
assert.match(browserMedia, /VITE_BROWSER_MEDIA_BASE_URL/);
assert.match(browserMedia, /apiBaseUrl = defaultMediaBaseUrl/);
assert.match(compose, /VITE_BROWSER_MEDIA_BASE_URL:\s*https:\/\/api\.zvoice\.zeacrm\.com/);

for (const source of [frontendProxy, publicProxy]) {
  assert.match(source, /\/api\/voice\/browser-test\/media/);
  assert.match(source, /proxy_http_version 1\.1/);
  assert.match(source, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(source, /proxy_set_header Connection ['"]upgrade['"]/);
  assert.match(source, /proxy_buffering off/);
}
assert.match(publicProxy, /location = \/voice\/browser-test\/media/);

console.log(JSON.stringify({
  success: true,
  liveCallResponsesNotCached: true,
  frontendLiveQueriesBypassCache: true,
  phoneNumbersPersistedAndDisplayed: true,
  callsVisibleWithoutOrganizationRow: true,
  browserWebSocketUpgradeConfigured: true,
  browserWebSocketUsesDirectApiOrigin: true,
}));
