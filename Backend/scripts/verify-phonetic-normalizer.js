import { normalizeTranscript } from '../src/voice/interaction/phonetic-normalizer.js';

const testCases = [
  { input: 'ஜியா சியா ராமோட ஸ்டார்ட்டர் பிரைசிங் எவ்ளோ', expected: 'Zea CRM-oda ஸ்டார்ட்டர் பிரைசிங் எவ்ளோ' },
  { input: 'இல்ல ஜியா சிஆர்எம்', expected: 'இல்ல Zea CRM' },
  { input: 'சரி ஜியா ப்ளேனா என்ன', expected: 'சரி Zea Play-na என்ன' },
  { input: 'சி வாய்ஸ்னா', expected: 'Zea Voice-na' },
  { input: 'ஸீ வாய்ஸ்னா என்ன', expected: 'Zea Voice-na என்ன' },
  { input: 'சரி தியா பிரைன் என்ன', expected: 'சரி Zea Brain என்ன' },
  { input: 'இது வேறு மொழி (hindi)', expected: 'இது வேறு மொழி (hindi)', lang: 'hi-IN' }
];

let failed = 0;

for (const tc of testCases) {
  const result = normalizeTranscript(tc.input, tc.lang ?? 'ta-IN');
  if (result !== tc.expected) {
    console.error(`FAILED: ${tc.input}`);
    console.error(`  Expected: ${tc.expected}`);
    console.error(`  Got:      ${result}`);
    failed++;
  } else {
    console.log(`PASS: ${tc.input} -> ${result}`);
  }
}

if (failed === 0) {
  console.log('All tests passed!');
  process.exit(0);
} else {
  console.error(`${failed} tests failed!`);
  process.exit(1);
}
