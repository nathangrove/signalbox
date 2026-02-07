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
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildSummaryUserPrompt(input) }
  ];
}
