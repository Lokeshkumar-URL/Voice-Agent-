export const TAMIL_PHONETICS_MAP = {
  "ஜியா சியா ராமோட": "Zea CRM-oda",
  "ஜியா சியா ராம்": "Zea CRM",
  "ஜியா சிஆர்எம்": "Zea CRM",
  "ஜியா ப்ளேனா": "Zea Play-na",
  "ஜியா ப்ளே": "Zea Play",
  "சி வாய்ஸ்னா": "Zea Voice-na",
  "சி வாய்ஸ்": "Zea Voice",
  "வி வாய்ஸ்": "Zea Voice",
  "ஸீ வாய்ஸ்னா": "Zea Voice-na",
  "ஸீ வாய்ஸ்": "Zea Voice",
  "தியா பிரைன்": "Zea Brain",
  "ஜியா பிரைன்": "Zea Brain",
  "ஜி ப்ரைன்": "Zea Brain",
  "என்ன ஆள": "Zea AI"
};

export function normalizeTranscript(text, languageCode) {
  if (!text || (languageCode && !languageCode.startsWith('ta'))) {
    return text;
  }
  
  let normalized = text;
  for (const [phonetic, correction] of Object.entries(TAMIL_PHONETICS_MAP)) {
    // Escape phonetic for safe regex
    const escapedPhonetic = phonetic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Global replacement
    const regex = new RegExp(escapedPhonetic, 'g');
    normalized = normalized.replace(regex, correction);
  }
  return normalized;
}
