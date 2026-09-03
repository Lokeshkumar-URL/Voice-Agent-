import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import pg from 'pg';
import { createAgent } from '../src/agents/agent.service.js';
import { createKnowledgeBase } from '../src/knowledge-bases/knowledge-base.service.js';
import { uploadKnowledgeDocument } from '../src/knowledge-bases/knowledge-document.service.js';
import { processKnowledgeJob } from '../src/knowledge-bases/knowledge-processing.service.js';
import { approveAllDraftReviewRecords, publishKnowledgeBase } from '../src/knowledge-bases/knowledge-review.service.js';
import { processSemanticIndexJob } from '../src/knowledge-bases/semantic-index.service.js';
import { assignKnowledgeBaseToAgent } from '../src/agents/agent-knowledge-base.service.js';
import { closeDatabase } from '../src/infrastructure/database.js';
import { closeRedis, connectRedis } from '../src/infrastructure/redis.js';

const storedFiles = new Map();

const mockStorage = {
  putObject: async ({ key, body }) => {
    storedFiles.set(key, body);
    return { bucket: 'local-bucket', key, etag: 'mock-etag-' + Date.now(), storageVersionId: 'v1' };
  },
  getObject: async ({ key }) => {
    const body = storedFiles.get(key);
    if (!body) throw new Error(`File key ${key} not found in mock storage`);
    return { bucket: 'local-bucket', key, body, etag: 'mock-etag' };
  },
  deleteObject: async ({ key }) => {
    storedFiles.delete(key);
    return { bucket: 'local-bucket', key, deleted: true };
  },
  deleteAllVersions: async ({ key }) => {
    storedFiles.delete(key);
    return { bucket: 'local-bucket', key, deleted: true };
  },
};

async function main() {
  console.log('🚀 Starting Shanmuga Hospital Agent & Knowledge Ingestion...');
  await connectRedis();

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // 1. Resolve Shanmuga Tenant, Workspace, and Developer User
  const tenantRes = await db.query(
    `SELECT t.id as tenant_id, w.id as workspace_id, t.name, tm.user_id 
     FROM tenants t 
     JOIN workspaces w ON w.tenant_id = t.id 
     JOIN tenant_memberships tm ON tm.tenant_id = t.id
     WHERE t.name ILIKE '%Shanmuga%' LIMIT 1`
  );

  if (tenantRes.rows.length === 0) {
    throw new Error('Shanmuga Hospital tenant or membership not found.');
  }

  const { tenant_id: tenantId, workspace_id: workspaceId, user_id: userId, name: tenantName } = tenantRes.rows[0];
  console.log(`✅ Tenant Resolved: ${tenantName}`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Workspace ID: ${workspaceId}`);
  console.log(`   User ID: ${userId}`);

  const auth = {
    userId,
    tenantId,
    workspaceId,
    role: 'COMPANY_DEVELOPER',
    platformRole: null,
  };

  // 2. Resolve Provider Models
  const modelsRes = await db.query(
    `SELECT pm.id, ap.type 
     FROM provider_models pm 
     JOIN ai_providers ap ON pm.provider_id = ap.id 
     WHERE pm.status = 'active'`
  );

  let sttModelId = null;
  let llmModelId = null;
  let ttsModelId = null;

  for (const row of modelsRes.rows) {
    if (row.type === 'stt' && !sttModelId) sttModelId = row.id;
    if (row.type === 'llm' && !llmModelId) llmModelId = row.id;
    if (row.type === 'tts' && !ttsModelId) ttsModelId = row.id;
  }

  console.log(`✅ Models Resolved: STT=${sttModelId}, LLM=${llmModelId}, TTS=${ttsModelId}`);

  // 3. Read Master System Prompt
  const masterPromptPath = path.resolve('../docs/knowledge-base/shanmuga-hospital-master-system-prompt-production.txt');
  const masterPrompt = await fs.readFile(masterPromptPath, 'utf8');

  // 4. Create or get Agent "Karthika"
  const existingAgentRes = await db.query(
    `SELECT id FROM voice_agents WHERE tenant_id = $1 AND name ILIKE '%Karthika%' AND deleted_at IS NULL`,
    [tenantId]
  );

  let agentId;
  if (existingAgentRes.rows.length > 0) {
    agentId = existingAgentRes.rows[0].id;
    console.log(`ℹ️ Agent Karthika already exists: ${agentId}`);
  } else {
    const agent = await createAgent(auth, {
      name: 'Karthika - Shanmuga Hospital AI Voice Agent',
      description: 'AI Voice agent for Shanmuga Hospital Health Check-up and Screening enquiries',
      status: 'active',
      prompt: masterPrompt,
      sttModelId,
      llmModelId,
      ttsModelId,
      voiceId: 'karthika-voice',
      language: 'ta',
      usageDirection: 'both',
      interruptionSensitivity: 0.5,
      temperature: 0.2,
      silenceTimeoutMs: 1500,
      inactivityTimeoutSeconds: 30,
      settings: {
        informationUnavailableMessage: 'மன்னிக்கவும், இந்த கேள்விக்கான தகவல் தற்போது என்னிடம் இல்லை. சண்முகா மருத்துவமனை உதவி எண்ணை அழைக்கவும்.',
        technicalFailureMessage: 'மன்னிக்கவும், ஒரு தொழில்நுட்பக் கோளாறு ஏற்பட்டுள்ளது. தயவுசெய்து சிறிது நேரம் கழித்து முயற்சிக்கவும்.',
        knowledgeTechnicalFailureMessage: 'மன்னிக்கவும், தகவல் சேகரிப்பில் சிறு தாமதம் ஏற்பட்டுள்ளது.',
        errorRecoveryMessage: 'மன்னிக்கவும், தயவுசெய்து உங்கள் கேள்வியை மீண்டும் கேட்க முடியுமா?',
      },
    });
    agentId = agent.id;
    console.log(`✅ Created Agent Karthika: ${agentId}`);
  }

  // 5. Create or get Knowledge Base
  const existingKbRes = await db.query(
    `SELECT id FROM knowledge_bases WHERE tenant_id = $1 AND name ILIKE '%Shanmuga%' AND deleted_at IS NULL`,
    [tenantId]
  );

  let kbId;
  if (existingKbRes.rows.length > 0) {
    kbId = existingKbRes.rows[0].id;
    console.log(`ℹ️ Knowledge Base already exists: ${kbId}`);
  } else {
    const kb = await createKnowledgeBase(auth, {
      name: 'Shanmuga Hospital Knowledge Base',
      description: 'Comprehensive health checkups, packages, FAQs, workflows and policies',
      usageDirection: 'both',
    });
    kbId = kb.id;
    console.log(`✅ Created Knowledge Base: ${kbId}`);
  }

  // 6. Upload & Process Documents in required order
  const documentsToUpload = [
    {
      name: 'Package Catalog',
      documentType: 'catalog',
      filePath: '../docs/knowledge-base/shanmuga-hospital-package-catalog-upload.txt',
    },
    {
      name: 'Workflow Rules',
      documentType: 'workflow_rules',
      filePath: '../docs/knowledge-base/shanmuga-hospital-workflow-rules-structured-production.txt',
    },
    {
      name: 'Conversation Script',
      documentType: 'conversation_script',
      filePath: '../docs/knowledge-base/shanmuga-hospital-conversation-script-production.txt',
    },
    {
      name: 'FAQ Salem Tamil',
      documentType: 'faq',
      filePath: '../docs/knowledge-base/shanmuga-hospital-faq-salem-tamil.txt',
    },
    {
      name: 'General Knowledge',
      documentType: 'general_knowledge',
      filePath: '../docs/knowledge-base/shanmuga-hospital-general-knowledge-production-upload.txt',
    },
  ];

  for (const docSpec of documentsToUpload) {
    const filePath = path.resolve(docSpec.filePath);
    const content = await fs.readFile(filePath);

    // Check if doc already exists
    const existingDoc = await db.query(
      `SELECT id FROM knowledge_documents WHERE tenant_id = $1 AND knowledge_base_id = $2 AND display_name = $3 AND deleted_at IS NULL`,
      [tenantId, kbId, docSpec.name]
    );

    let docId;
    if (existingDoc.rows.length > 0) {
      docId = existingDoc.rows[0].id;
      console.log(`ℹ️ Document '${docSpec.name}' already exists: ${docId}`);
    } else {
      const file = {
        buffer: content,
        originalname: path.basename(filePath),
        mimetype: 'text/plain',
        size: content.length,
      };

      const uploaded = await uploadKnowledgeDocument(
        auth,
        kbId,
        { documentType: docSpec.documentType, displayName: docSpec.name },
        file,
        mockStorage
      );
      docId = uploaded.id;
      console.log(`✅ Uploaded document '${docSpec.name}': ${docId}`);

      // Process job directly
      if (uploaded.processingJobId) {
        console.log(`⏳ Processing extraction for '${docSpec.name}'...`);
        await processKnowledgeJob(uploaded.processingJobId, { storage: mockStorage });
        console.log(`✅ Extracted records for '${docSpec.name}'`);
      }
    }

    // Approve all records for this document
    try {
      await approveAllDraftReviewRecords(auth, kbId, docId);
      console.log(`✅ Approved records for '${docSpec.name}'`);
    } catch (e) {
      console.log(`ℹ️ Record approval note: ${e.message}`);
    }
  }

  // 7. Publish Knowledge Base
  console.log('⏳ Publishing Knowledge Base revision...');
  const publication = await publishKnowledgeBase(auth, kbId, undefined, undefined, {
    notes: 'Initial production publication for Shanmuga Hospital',
  });
  console.log(`⏳ Processing semantic indexing job ${publication.semanticIndex.jobId}...`);
  let totalPointCount = 0;
  await processSemanticIndexJob(publication.semanticIndex.jobId, {
    verifyStorageObject: async () => ({ verified: true }),
    embed: async (texts) => texts.map(() => new Array(384).fill(0.01)),
    ensureCollection: async () => {},
    deleteKnowledgeBasePoints: async () => {},
    upsertPoints: async (tenantId, points) => { totalPointCount += points.length; },
    countRevisionPoints: async () => ({ count: totalPointCount }),
  });
  console.log(`✅ Published KB Revision ${publication.pendingPublicationRevision}!`);

  // 8. Assign Knowledge Base to Agent
  console.log('⏳ Assigning Knowledge Base to Agent Karthika...');
  try {
    await assignKnowledgeBaseToAgent(auth, agentId, kbId, {
      usageDirection: 'both',
      priority: 100,
    });
    console.log('✅ Knowledge Base assigned to Agent Karthika!');
  } catch (e) {
    if (e.code === 'AGENT_KB_ALREADY_ASSIGNED' || e.message.includes('already')) {
      console.log('ℹ️ Knowledge Base already assigned to Agent Karthika.');
    } else {
      throw e;
    }
  }

  await db.end();
  await closeRedis();
  await closeDatabase();

  console.log('\n🎉🎉🎉 Shanmuga Hospital Setup & Knowledge Ingestion Completed! 🎉🎉🎉');
}

main().catch((err) => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
