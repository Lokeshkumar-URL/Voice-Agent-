export const TAMIL_PHONETICS_MAP = {
  "சாஃப்ட்வேர் சொல்யூஷன்ஸ்": "Software Solutions",
  "சாப்ட்வேர் சொல்யூசன்ஸ்": "Software Solutions",
  "சாஃப்ட்வேர் சொல்யூசன்": "Software Solutions",
  "சாஃப்ட்வேர்": "Software",
  "சொல்யூஷன்ஸ்": "Solutions",
  "சொல்யூசன்ஸ்": "Solutions",
  "சர்வீசஸ்": "Services",
  "ப்ராடக்ட்ஸ்": "Products",
  "யுஆர்எல் ஃபேக்டரி": "URL Factory",
  "யு.ஆர்.எல். ஃபேக்டரி": "URL Factory",
  "சியராம்": "Zea CRM",
  "சியாராம்": "Zea CRM",
  "சியார்எம்": "Zea CRM",
  "சிஆர்எம்": "Zea CRM",
  "பர்ச்சேஸ்": "Purchase",
  "வாங்குவது": "Purchase",
  "வாங்கலாம்": "Purchase",
  "விலை": "Pricing",
  "கட்டணம்": "Pricing",
  "ஜியா சியா ராமோட": "Zea CRM-oda",
  "ஜியா சியா ராம்": "Zea CRM",
  "ஜியா சிஆர்எம்": "Zea CRM",
  "தியரம்": "Zea CRM",
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
  "ஜீ பிரைன்": "Zea Brain",
  "ஜீ ஏஐ": "Zea AI",
  "ஸியா ஏஐ": "Zea AI",
  "என்ன ஆள": "Zea AI",
  "ஸியா": "Zea AI"
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
