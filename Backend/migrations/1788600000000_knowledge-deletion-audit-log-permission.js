export async function up(pgm) {
  pgm.sql(`
    DROP POLICY IF EXISTS audit_logs_knowledge_delete_policy ON audit_logs;
    CREATE POLICY audit_logs_knowledge_delete_policy ON audit_logs
      FOR DELETE TO zea_voice_runtime
      USING (zea_is_platform_admin());

    GRANT DELETE ON audit_logs TO zea_voice_runtime;

    COMMENT ON POLICY audit_logs_knowledge_delete_policy ON audit_logs IS
      'Allows the platform-admin deletion worker to remove references during permanent Knowledge Base cleanup.';
  `);
}

export async function down(pgm) {
  pgm.sql(`
    DROP POLICY IF EXISTS audit_logs_knowledge_delete_policy ON audit_logs;
    REVOKE DELETE ON audit_logs FROM zea_voice_runtime;
  `);
}
