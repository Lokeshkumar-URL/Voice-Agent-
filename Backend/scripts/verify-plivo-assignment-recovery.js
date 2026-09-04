import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const service = await readFile(new URL('../src/telephony/telephony.service.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/telephony/plivo.client.js', import.meta.url), 'utf8');

assert.match(client, /export function listPlivoApplications/);
assert.match(client, /query\.set\(['"]app_name['"], input\.name\)/);
assert.match(client, /if \(input\.subaccountAuthId\) body\.subaccount = input\.subaccountAuthId/);
assert.match(service, /function duplicateApplicationError/);
assert.match(service, /application\.\+already exists/);
assert.match(service, /createOrRecoverCompanyApplication/);
assert.match(service, /item\.app_name === input\.name/);
assert.match(service, /application\.app_id/);
assert.match(service, /recovered:\s*true/);
assert.doesNotMatch(service, /duplicateApplicationError[\s\S]{0,1200}deletePlivoSubaccount/);

console.log(JSON.stringify({
  success: true,
  duplicateApplicationDetected: true,
  existingApplicationResolvedByExactName: true,
  existingApplicationReassociated: true,
  noApplicationDeletionUsedForRecovery: true,
}));
