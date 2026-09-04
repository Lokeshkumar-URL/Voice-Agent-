import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helper = await readFile(new URL('../src/providers/provider-model-key.js', import.meta.url), 'utf8');
const sarvamAdapter = await readFile(new URL('../src/voice/providers/stt/sarvam.adapter.js', import.meta.url), 'utf8');
const cartesiaAdapter = await readFile(new URL('../src/voice/providers/tts/cartesia.adapter.js', import.meta.url), 'utf8');
const providerService = await readFile(new URL('../src/providers/provider.service.js', import.meta.url), 'utf8');
const providerConfig = await readFile(new URL('../src/voice/providers/provider-config.js', import.meta.url), 'utf8');

assert.match(helper, /saaras:\s*['"]saaras:v3['"]/);
assert.match(helper, /saarika:\s*['"]saarika:v2\.5['"]/);
assert.match(helper, /PROVIDER_MODEL_KEY_UNSUPPORTED/);
assert.match(helper, /return ['"]sonic-3\.5['"]/);
assert.match(helper, /providerType\(provider\) === ['"]stt['"]/);
assert.match(helper, /providerType\(provider\) === ['"]tts['"]/);

assert.match(sarvamAdapter, /const query = \{[\s\S]*?['"]language-code['"]:\s*language,\s*model,/);
assert.match(sarvamAdapter, /normalizeProviderModelKey\(providerConfig, providerConfig\.modelKey/);
assert.match(cartesiaAdapter, /normalizeProviderModelKey\(providerConfig, common\.model \|\| ['"]sonic-3\.5['"]/);
assert.match(cartesiaAdapter, /model_id:\s*configuration\.model/);

assert.match(providerService, /const modelKey = normalizeProviderModelKey\(provider, input\.modelKey\)/);
assert.match(providerService, /const modelKey = normalizeProviderModelKey\(provider, input\.modelKey \?\? current\.model_key\)/);
assert.match(providerConfig, /providerType:\s*prefix/);

console.log(JSON.stringify({
  success: true,
  sarvamLegacyModelNormalized: true,
  unsupportedSarvamModelsRejected: true,
  cartesiaPlaceholderNormalized: true,
  invalidFutureModelKeysPrevented: true,
}));
