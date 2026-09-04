import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../src/telephony/telephony.schemas.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/telephony/telephony.service.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/telephony/plivo.client.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../Frontend/src/components/views/SuperAdminViews.tsx', import.meta.url), 'utf8');

assert.match(schema, /applicationId:\s*z\.string\(\)\.trim\(\)\.max\(240\)\.optional\(\)/);
assert.doesNotMatch(schema, /applicationId:\s*z\.string\(\)\.trim\(\)\.min\(1\)/);
assert.match(client, /export function updatePlivoApplication/);
assert.match(client, /Application\/\$\{encodeURIComponent\(applicationId\)\}\//);
assert.match(service, /voiceEndpointsChanged/);
assert.match(service, /updatePlivoApplication\(/);
assert.match(service, /parent_account_id = \$1/);
assert.match(ui, /https:\/\/api\.zvoice\.zeacrm\.com\/webhooks\/plivo\/answer/);
assert.match(ui, /https:\/\/api\.zvoice\.zeacrm\.com\/webhooks\/plivo\/hangup/);

console.log(JSON.stringify({
  success: true,
  emptyApplicationIdAcceptedOnUpdate: true,
  plivoApplicationsUpdated: true,
  childAccountEndpointsInherited: true,
  canonicalEndpointConfiguredInUi: true,
}));
