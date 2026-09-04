import { AppError } from '../middleware/errors.js';

const sarvamSttModels = new Map([
  ['saarika:v2.5', 'saarika:v2.5'],
  ['saaras:v3', 'saaras:v3'],
  ['saaras:v4', 'saaras:v4'],
]);

function providerIdentity(provider = {}) {
  return [provider.slug, provider.providerSlug, provider.name, provider.providerName]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
}

function isProvider(provider, name) {
  return providerIdentity(provider).some((value) => value.includes(name));
}

function providerType(provider = {}) {
  return String(provider.type ?? provider.providerType ?? '').trim().toLowerCase();
}

export function normalizeProviderModelKey(provider, modelKey, { statusCode = 400 } = {}) {
  const configured = String(modelKey ?? '').trim();
  if (!configured) {
    throw new AppError(statusCode, 'Provider model key is required', 'PROVIDER_MODEL_KEY_REQUIRED');
  }

  if (providerType(provider) === 'stt' && isProvider(provider, 'sarvam')) {
    const normalized = configured.toLowerCase();
    const legacyAliases = {
      saaras: 'saaras:v3',
      saarika: 'saarika:v2.5',
    };
    const resolved = legacyAliases[normalized] ?? sarvamSttModels.get(normalized);
    if (!resolved) {
      throw new AppError(
        statusCode,
        `Unsupported Sarvam STT model '${configured}'`,
        'PROVIDER_MODEL_KEY_UNSUPPORTED',
        { supportedModels: [...sarvamSttModels.values()] },
      );
    }
    return resolved;
  }

  if (providerType(provider) === 'tts' && isProvider(provider, 'cartesia')) {
    const normalized = configured.toLowerCase().replace(/[ _]+/g, '-');
    if (['cartesia', 'cartesia-tts', 'default'].includes(normalized)) return 'sonic-3.5';
  }

  return configured;
}
