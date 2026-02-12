export const CATEGORIES = {
  primary: {
    prompt: 'things that need a response or action from me',
    heuristicKeywords: [],
    summarize: true
  },
  updates: {
    prompt: 'notifications about my account activity',
    heuristicKeywords: ['notification', 'alert', 'account update', 'security', 'password', 'login', 'verification'],
    summarize: true
  },
  social: {
    prompt: 'social media notifications',
    heuristicKeywords: ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'social'],
    summarize: false
  },
  newsletters: {
    prompt: 'informational newsletters and digests',
    heuristicKeywords: ['newsletter', 'daily digest', 'weekly digest', 'monthly digest', 'subscribe', 'unsubscribe', 'newsletter digest'],
    summarize: false
  },
  promotions: {
    prompt: 'things trying to sell me something',
    heuristicKeywords: ['sale', 'deal', 'promo', 'promotion', '% off', 'discount', 'coupon'],
    summarize: false
  },
  other: {
    prompt: 'catch all for anything else',
    heuristicKeywords: [],
    summarize: false
  }
};

export const CLASSIFY_SYSTEM_PROMPT = 'You are an email classifier. Return JSON only.';

export function buildClassifierUserPrompt(input: { subject: string; from: string; body: string }): string {
  return (
    // concat the categories <category> (<prompt>) with commas
    `Classify this email into one of: ${Object.keys(CATEGORIES)
      .map((key) => `${key} (${CATEGORIES[key as keyof typeof CATEGORIES]?.prompt})`)
      .join(', ')}. Also set spam true/false. Determine cold true/false (whether this is a cold email).\n\n` +
    'Also set spam true/false. Determine cold true/false (whether this is a cold email). Give a one sentance reason for why you chose this category.\n\n' +
    'If there is bad grammer or the text looks obfuscated with random characters or non-english characters, it is likely spam. Links that look obfuscated does not necessarily mean spam.\n\n' +
    'Respond with a single JSON object with the most likely category: {"category":"...","spam":true|false,"confidence":0..1,"cold":true|false,"reason": "..."}.\n\n' +
    `Subject: ${input.subject}\nFrom: ${input.from}\nBody: ${input.body}`
  );
}

export function buildClassifierMessages(input: { subject: string; from: string; body: string }) {
  return [
    {
      role: 'system',
      content: CLASSIFY_SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: buildClassifierUserPrompt(input)
    }
  ];
}

export const SUMMARY_SYSTEM_PROMPT =
  'You are an assistant that reads an email and returns a short (1-2 sentence) summary, a single recommended action if appropriate, any calendar event(s), and shipment tracking information. Return JSON only. Tracking must be for shipments only (carriers like Amazon, UPS, USPS, FedEx, DHL). Do not treat marketing/analytics link tracking parameters as shipment tracking.';

export function buildSummaryUserPrompt(input: { subject: string; from: string; body: string }): string {
  return (
    `Return a single JSON object only: {"summary":"...","action":{"type":"reply"|"click_link"|"mark_read"|"archive"|"flag"|"none","reason":"...","details":{}}, "confidence":0..1, "events":[{"summary":"..","start":"ISO8601","end":"ISO8601","location":"...","attendees":["name <email>"]}], "tracking":[{"carrier":"AMAZON|UPS|USPS|FEDEX|DHL|OTHER","trackingNumber":"...","url":"...","status":"...","deliveryDate":"ISO8601"}] }.

` +
    'Tracking entries must be for shipments only. Do NOT add tracking items for links that merely include tracking parameters (utm_*, ref=, clickId, etc.). If no events or shipment tracking items are found, return empty arrays for those keys.\n\n' +
    `Email:\nSubject: ${input.subject}\nFrom: ${input.from}\nBody: ${input.body}`
  );
}

export function buildSummaryMessages(input: { subject: string; from: string; body: string }) {
  return [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT_V2 },
    { role: 'user', content: buildSummaryUserPromptV2(input) }
  ];
}


export const SUMMARY_SYSTEM_PROMPT_V2 = `System (instructions for the assistant)
You are an automated email analyzer. For each email input you must:

Read the full email (subject, from, body) and extract structured information.
Produce exactly one JSON object and nothing else (no explanations, no markdown, no additional text).
Never hallucinate: only include events, tracking, or facts that are clearly present in the email text, headers, or explicit links.
Follow the JSON schema and rules in the "Output requirements" section precisely.
Input format (will be provided as-is)
The email will be provided delimited by triple quotes in this exact form:

"""
Subject: <subject line>
From: <name and/or email>
Body:
<full email body (may include quoted text, HTML, inline links, tracking numbers, dates, times, timezone info)>
"""

Output requirements (strict)
Return a single JSON object only with these keys and types:

summary (string): A concise 1–2 sentence human-readable summary of the email's main point(s). Prefer active voice.
action (object): A single recommended action or "none".
type (string, one of): "reply", "click_link", "mark_read", "archive", "flag", "none"
reason (string): Short justification for the recommendation.
details (object): If type is "reply", include {"to":"email or name","suggested_reply":"one-sentence reply"}; if type is "click_link", include {"url":"...", "link_text":"..."}; otherwise {}.
confidence (number): Decimal between 0.0 and 1.0 representing confidence in extraction (facts, events, tracking). Round to two decimal places.
events (array): Zero or more calendar events found in the email; if none, return an empty array.
Each event is an object: {"summary":"...", "start":"ISO8601", "end":"ISO8601 or null", "location":"...", "attendees":["Name <email>","..."], "allDay": true|false}
Use ISO8601 with timezone offset (e.g., "2026-02-12T14:00:00-05:00"). If only a date is present, use "YYYY-MM-DD" and set allDay: true and start = that date, end = null.
If the email mentions a relative time ("tomorrow 10am") convert to an ISO8601 anchored to the email send date if that information is available; otherwise leave event out (do not guess).
tracking (array): Zero or more shipment tracking entries; if none, return an empty array.
Each entry: {"carrier":"AMAZON|UPS|USPS|FEDEX|DHL|OTHER", "trackingNumber":"...", "url":"...", "status":"... or null", "deliveryDate":"ISO8601 or null"}
Only include entries for actual shipment tracking numbers/links referencing parcel carriers. Do NOT include links that merely contain marketing/UTM/ref/clickId parameters. Do NOT treat promo or affiliate links as tracking.
If carrier is ambiguous but clearly a shipment link/number, use "OTHER".
If delivery date or status is explicit in the email, capture it; otherwise set to null.
General rules

JSON must be valid, keys in the specified order are preferred but not required.
If no events or no tracking items are found, return [] for those keys.
If no recommended action, set action.type to "none", action.reason to a brief string, and action.details to {}.
confidence should reflect how directly the information is stated in the email (explicit: >0.8, implied but plausible: 0.5–0.8, ambiguous/low evidence: <0.5).
If multiple conflicting dates/times appear for the same event, do NOT invent a single resolution—omit the event and set confidence lower.
Parse attendee email addresses when presented as "Name email@example.com" or plain emails; otherwise include the textual attendee string.
Extraction priorities (ranked)

Shipments and tracking numbers (explicit carrier/number/links).
Calendar events (explicit invites, dates, times).
Single recommended action and concise summary.
Anything ambiguous should be omitted rather than guessed.
Examples (valid outputs)
Example 1 — no events, one shipment:
{
  "summary": "Your order has shipped and is expected to be delivered next Tuesday.",
  "action": { "type": "none", "reason": "Informational shipment update; no reply needed", "details": {} },
  "confidence": 0.92,
  "events": [],
  "tracking": [
    {
      "carrier": "FEDEX",
      "trackingNumber": "123456789012",
      "url": "https://www.fedex.com/fedextrack/?tracknumbers=123456789012",
      "status": "In Transit",
      "deliveryDate": "2026-02-17T00:00:00-05:00"
    }
  ]
}

Example 2 — event present, suggested reply:
{
  "summary": "Alice proposed a meeting on 2026-03-01 at 09:00 for project kickoff.",
  "action": {
    "type": "reply",
    "reason": "Organizer requested confirmation",
    "details": { "to": "alice@example.com", "suggested_reply": "Yes — I can attend the kickoff on March 1 at 9:00." }
  },
  "confidence": 0.88,
  "events": [
    {
      "summary": "Project kickoff",
      "start": "2026-03-01T09:00:00-07:00",
      "end": "2026-03-01T10:00:00-07:00",
      "location": "Zoom",
      "attendees": ["Alice <alice@example.com>"],
      "allDay": false
    }
  ],
  "tracking": []
}

Edge cases and explicit directions
Do not follow links. Only extract the URL string when it is explicitly present in the email.
Do not invent timezones. If a timezone is explicitly stated, use it; otherwise prefer the sender's timezone if present in headers; if unavailable, use the explicit offset in the message or omit the event.
Do not extract marketing link “trackers” such as utm_*, ref=, clickId, or affiliate query strings as shipment tracking.
For ambiguous numeric sequences that might be order numbers vs tracking numbers, include as tracking only if the email context explicitly states shipment/carrier or a shipment-related phrase (e.g., "shipped", "tracking number", "out for delivery").
For HTML emails, prefer the visible text; ignore decorative or code comments.
Preserve privacy: do not add external data or lookup carrier status beyond the email content.
Processing steps the assistant must follow (internal)
Scan email for explicit carrier names and tracking number patterns typical of those carriers.
Scan the body for calendar phrases (dates, times, "meeting", "invite", "RSVP", "call") and only extract explicit events.
Compose a 1–2 sentence summary describing the key intent or update.
Determine a single best next action and populate action.details accordingly.
Set confidence reflecting how explicit the source text is.
Emit exactly one JSON object and nothing else.
`

export function buildSummaryUserPromptV2(input: { subject: string; from: string; body: string }): string {
return `Use the provided triple-quoted email as the input to analyze.

"""
Subject: ${input.subject}
From: ${input.from}
Body:
${input.body}
"""`;
};