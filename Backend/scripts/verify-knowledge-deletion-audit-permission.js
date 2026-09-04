import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../migrations/1788600000000_knowledge-deletion-audit-log-permission.js',
  import.meta.url,
);
const deletionServiceUrl = new URL(
  '../src/knowledge-bases/knowledge-deletion.service.js',
  import.meta.url,
);

const [migration, deletionService] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(deletionServiceUrl, 'utf8'),
]);

assert.match(migration, /GRANT DELETE ON audit_logs TO zea_voice_runtime/);
assert.match(migration, /FOR DELETE TO zea_voice_runtime/);
assert.match(migration, /USING \(zea_is_platform_admin\(\)\)/);
assert.doesNotMatch(
  migration,
  /USING \(zea_is_platform_admin\(\) OR tenant_id = zea_current_tenant_id\(\)\)/,
  'Tenant sessions must not gain permission to delete audit history',
);
assert.match(migration, /REVOKE DELETE ON audit_logs FROM zea_voice_runtime/);

assert.match(deletionService, /DELETE FROM audit_logs audit/);
assert.match(deletionService, /cleanHistoricalKnowledgeBaseReferences/);
assert.match(deletionService, /hardDeleteKnowledgeBaseInTransaction/);

console.log(JSON.stringify({
  task: 'Knowledge Base deletion audit permission',
  passed: true,
  checks: {
    runtimeDeletePrivilegeAdded: true,
    platformAdminDeletePolicyAdded: true,
    tenantAuditDeletionStillBlocked: true,
    rollbackRevokesPrivilege: true,
    deletionWorkerUsesGuardedCleanup: true,
  },
}, null, 2));
