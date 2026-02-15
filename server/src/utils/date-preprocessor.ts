// Use require for runtime compatibility with CommonJS builds
const _chrono: any = require('chrono-node');
const chrono = _chrono && _chrono.parse ? _chrono : (_chrono && _chrono.default ? _chrono.default : _chrono);

export type Candidate = {
  startIso: string;
  endIso?: string;
  matchText: string;
  snippet: string;
  index: number;
  charIndex: number;
};

export function extractDateCandidates(emailText: string, referenceDate?: Date): Candidate[] {
  if (!emailText) return [];
  const results = chrono.parse(emailText, referenceDate ?? new Date());
  const window = 120; // characters of context on either side

  return results
    .map((r: any, i: number) => {
      const start = r.start?.date?.();
      if (!start) return null;
      const end = r.end?.date?.();
      const matchIndex = typeof r.index === 'number' ? r.index : 0;
      const matchedText = r.text ?? '';
      const snipStart = Math.max(0, matchIndex - window);
      const snipEnd = Math.min(emailText.length, matchIndex + matchedText.length + window);
      const snippet = emailText.slice(snipStart, snipEnd).replace(/\s+/g, ' ').trim();
      return {
        startIso: start.toISOString(),
        endIso: end ? end.toISOString() : undefined,
        matchText: matchedText,
        snippet,
        index: i,
        charIndex: matchIndex,
      } as Candidate;
    })
    .filter(Boolean) as Candidate[];
}

export function buildEventLabelPrompt(subject: string, candidates: Candidate[], emailReceivedIso?: string): string {
  const candidateBlock = candidates
    .map((c, idx) => `Candidate ${idx + 1}:\n- start: ${c.startIso}\n- end: ${c.endIso ?? '<none>'}\n- text: "${c.matchText}"\n- snippet: "${c.snippet}"`)
    .join('\n\n');

  return `You will receive date/time candidates (ISO) + a short surrounding snippet from a school/newsletter email.\nReturn a single JSON object: { "events": [ ... ] }.\nFor each candidate, if it describes an event or deadline create an object with keys: start (ISO), end (ISO, optional), title, description, location (optional), rsvp (optional URL), confidence (0.0-1.0).\nIf the candidate is NOT an event, omit it.\n\nEmail subject: "${subject}"\nEmail received (reference): ${emailReceivedIso ?? 'none'}\n\nCandidates:\n${candidateBlock}\n\nEXAMPLE\nInput snippet: "Spring Carnival on May 7 from 10am–2pm in the gym."\nOutput event: { "title": "Spring Carnival", "start": "2026-05-07T10:00:00-07:00", "end": "2026-05-07T14:00:00-07:00", "location":"School gym", "confidence":0.95 }\n\nNow produce the JSON for the candidates above. Output must be valid JSON and nothing else.`;
}

export default { extractDateCandidates, buildEventLabelPrompt };
