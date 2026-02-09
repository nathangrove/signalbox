/* Simple HTTP client to call the classifier service
   Usage: import { classifyEmail } from './utils/classifier.client'
*/
export async function classifyEmail(subject: string, body: string) {
  const url = process.env.CLASSIFIER_URL || 'http://classifier:8000/predict'
  const payload = { subject: subject || '', body: body || '' }
  // @ts-ignore - rely on global fetch in Node runtime or polyfill if needed
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    // keep short timeout on server-side calls if desired
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Classifier request failed: ${res.status} ${text}`)
  }
  return res.json()
}
