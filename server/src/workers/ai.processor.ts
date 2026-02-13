import { WorkerOptions } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { simpleParser } from 'mailparser';
import { Readable } from 'stream';
import { buildClassifierMessages, buildSummaryMessages, CATEGORIES } from './ai.prompts';
import { publishNotification } from '../notifications/redis-pub';

async function classifyWithLocalModel(input: { subject: string; from: string; body: string }) {
  // Build candidate endpoints. Prefer explicit env var; otherwise try docker service then localhost (dev-friendly).
  const envUrl = process.env.CLASSIFIER_URL && String(process.env.CLASSIFIER_URL).replace(/\/$/, '');
  const candidates: string[] = [];
  if (envUrl) candidates.push(envUrl.replace(/\/$/, '') + '/predict');
  else {
    candidates.push('http://classifier:8000/predict');
    // when running locally (non-production), also try localhost so developer `npm run dev` can hit the container
    if ((process.env.NODE_ENV || 'development') !== 'production') candidates.push('http://localhost:8000/predict');
  }

  const timeoutMs = Number(process.env.CLASSIFIER_REQUEST_TIMEOUT_MS || 10000);

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: input.subject || '', body: input.body || '' })
      }, timeoutMs);

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn('[ai] local classifier non-ok', url, res.status, txt.slice(0, 200));
        // try next candidate
        continue;
      }

      const data = await res.json();
      // expected: { spam_probability, categories, category_probs, predicted_category }
      const spam_p = Number(data?.spam_probability ?? 0);
      const predicted_category = String(data?.predicted_category || (Array.isArray(data?.categories) && data?.categories[0]) || 'other');
      const cat_probs = Array.isArray(data?.category_probs) ? data.category_probs : [];
      const cat_conf = cat_probs.length ? Math.max(...cat_probs) : 0.0;
      return { category: predicted_category, spam: spam_p >= 0.5, confidence: Math.max(spam_p, cat_conf), cold: false, reason: 'local-model', raw: data };
    } catch (e) {
      // If the attempt timed out/failed, try next candidate before giving up.
      console.warn('[ai] classifyWithLocalModel try failed', url, ((e as any)?.message || e));
      continue;
    }
  }

  // All candidates exhausted
  console.warn('[ai] classifyWithLocalModel no reachable classifier endpoints');
  return null;
}
function formatFrom(fromHeader: any): string {
  try {
    const list = Array.isArray(fromHeader) ? fromHeader : [];
    if (!list.length) return 'unknown';
    const first = list[0];
    return first.name ? `${first.name} <${first.address}>` : (first.address || 'unknown');
  } catch (_) {
    return 'unknown';
  }
}

function heuristicClassify(subject: string, from: string, body: string): { category: keyof typeof CATEGORIES; spam: boolean; confidence: number; cold: boolean; reason: string } {
  const text = `${subject} ${from} ${body}`.toLowerCase();
  const spam = /(free money|winner|viagra|casino|bitcoin|crypto giveaway|act now|urgent action required)/.test(text);
  const cold = /(i am reaching out to|contacting you regarding|we would like to offer|business proposal|partnership opportunity)/.test(text);

  if (spam) {
    return { category: 'other', spam: true, confidence: 0.9, cold: false, reason: 'heuristic spam match' };
  }
  if (cold) {
    return { category: 'other', spam: false, confidence: 0.9, cold: true, reason: 'heuristic cold match' };
  }

  // Check category keywords properly (stop on first match)
  for (const cat of Object.keys(CATEGORIES)) {
    const category = cat as keyof typeof CATEGORIES;
    const found = CATEGORIES[category].heuristicKeywords.find(kw => text.includes(kw));
    if (found) {
      return { category, spam: false, confidence: 0.6 + Math.random() * 0.3, cold: false, reason: `matched keyword: ${found}` };
    }
  }

  return { category: 'other', spam, confidence: 0.5, cold: false, reason: 'no heuristic match' };
}

// Robust JSON extractor: finds the first JSON object/array in text and parses it
function extractJson(text: string): any | null {
  if (!text || typeof text !== 'string') return null;
  const firstCurly = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let start = -1;
  let openChar = '';
  if (firstCurly === -1 && firstBracket === -1) return null;
  if (firstCurly === -1) { start = firstBracket; openChar = '['; }
  else if (firstBracket === -1) { start = firstCurly; openChar = '{'; }
  else { start = Math.min(firstCurly, firstBracket); openChar = start === firstCurly ? '{' : '['; }
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch (_) { break; }
      }
    }
  }

  // fallback attempts
  try { return JSON.parse(text); } catch (_) {}
  const lastClose = text.lastIndexOf(closeChar);
  if (lastClose > start) {
    try { return JSON.parse(text.slice(start, lastClose + 1)); } catch (_) {}
  }
  return null;
}

async function classifyWithLLM(input: { subject: string; from: string; body: string }) {
  // Support multiple LLM providers (OpenAI-compatible or GitHub Copilot via env)
  const llmProvider = (process.env.LLM_PROVIDER || '').toLowerCase();
  const useCopilot = llmProvider === 'copilot' || !!process.env.COPILOT_API_KEY;
  const base = (useCopilot ? (process.env.COPILOT_API_BASE || 'https://models.github.ai/inference') : (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1')).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const model = useCopilot ? (process.env.COPILOT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OPENAI_MODEL || 'gpt-4o-mini');
  const apiKey = useCopilot ? process.env.COPILOT_API_KEY : process.env.OPENAI_API_KEY;

  const messages = buildClassifierMessages(input);

  console.log(`[ai] classifyWithLLM calling provider=${useCopilot? 'copilot' : 'openai'} model=${model} url=${url}`);
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, messages })// , temperature: 0.1 })
    }, OPENAI_REQUEST_TIMEOUT_MS);
  } catch (fetchErr) {
    console.error('[ai] classifyWithLLM fetch error', fetchErr);
    throw fetchErr;
  }

  const rawText = await res.text();
  if (!res.ok) {
    console.error(`[ai] classifyWithLLM non-ok response status=${res.status} body=${rawText.slice(0,1000)}`);
    throw new Error(`LLM request failed: ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (parseErr) {
    console.error('[ai] classifyWithLLM response JSON parse failed', parseErr, `body=${rawText.slice(0,1000)}`);
    throw parseErr;
  }

  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (parsed !== null) return parsed;
  try {
    // As a last resort, try to JSON.parse the trimmed content
    return JSON.parse(String(content).trim());
  } catch (parseErr) {
    console.warn('[ai] classifyWithLLM response content is not JSON; falling back to heuristic', parseErr, `content=${String(content).slice(0,200)}`);
    return null;
  }
}

// Increase default OpenAI request timeout to 5 minutes to reduce aborts on slow/local endpoints
const OPENAI_REQUEST_TIMEOUT_MS = (() => {
  const raw = process.env.OPENAI_REQUEST_TIMEOUT_MS;
  const v = raw !== undefined && raw !== '' ? Number(raw) : NaN;
  if (Number.isFinite(v) && v > 0) return v;
  return 5 * 60 * 1000;
})();
console.log('[ai] OPENAI_REQUEST_TIMEOUT_MS=', OPENAI_REQUEST_TIMEOUT_MS);

// Label recorded in DB for which external provider was used
const LLM_PROVIDER_LABEL = (() => {
  if (process.env.COPILOT_API_KEY) return process.env.COPILOT_API_BASE ? 'copilot-compatible' : 'copilot';
  return process.env.OPENAI_API_BASE ? 'openai-compatible' : 'openai';
})();
// Canonical model string used when recording which model produced AI metadata
const LLM_MODEL = (() => {
  if (process.env.COPILOT_API_KEY) return process.env.COPILOT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
})();
const OPENAI_MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES || 2);
const OPENAI_RETRY_BASE_MS = Number(process.env.OPENAI_RETRY_BASE_MS || 1000);

function isRetryableError(err: any) {
  if (!err) return false;
  const name = String(err.name || '').toLowerCase();
  const code = String((err && err.code) || '').toLowerCase();
  // undici / fetch aborts present as AbortError (DOMException)
  if (name === 'aborterror' || name === 'domexception') return true;
  if (name === 'fetcherror') return true;
  // common network error codes
  if (['econnreset', 'etimedout', 'eai_again', 'enotfound'].includes(code)) return true;
  return false;
}

async function fetchWithTimeout(url: string, opts: any = {}, timeoutMs = OPENAI_REQUEST_TIMEOUT_MS) {
  let attempt = 0;
  while (true) {
    attempt++;
    console.debug(`[ai] fetchWithTimeout starting attempt=${attempt} timeoutMs=${timeoutMs} url=${url}`);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
      return res;
    } catch (err) {
      // If not retryable or we've exhausted retries, rethrow
      if (attempt > OPENAI_MAX_RETRIES || !isRetryableError(err)) {
        console.error(`[ai] fetchWithTimeout final failure attempt=${attempt} url=${url} error=`, err);
        throw err;
      }
      const backoff = OPENAI_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`[ai] fetchWithTimeout (${url}) attempt=${attempt} failed, retrying after ${backoff}ms`, (err as any)?.name || String(err));
      await new Promise((r) => setTimeout(r, backoff));
    } finally {
      clearTimeout(id);
    }
  }
}

export const aiJobProcessor = async (job: any) => {
  const prisma = new PrismaService();
  try {
    const { messageId, aiMetadataId } = job.data || {};
    console.log(`[ai] job.start id=${job.id} messageId=${messageId} aiMetadataId=${aiMetadataId}`);

    if (!messageId || !aiMetadataId) {
      console.error(`[ai] job.${job.id} missing params`, { messageId, aiMetadataId });
      throw new Error('messageId and aiMetadataId required');
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        subject: true,
        fromHeader: true,
        toHeader: true,
        raw: true
      }
    });

    if (!message) {
      console.error(`[ai] job.${job.id} message not found messageId=${messageId}`);
      throw new Error('message not found');
    }
    console.log(`[ai] job.${job.id} found message id=${message.id} subject="${(message.subject||'').slice(0,120)}"`);

    let body = '';
    if (message.raw) {
      console.log(`[ai] job.${job.id} parsing raw message`);
      const rawBuf = Buffer.isBuffer(message.raw) ? message.raw : Buffer.from(message.raw as Uint8Array);
      const parsed = await simpleParser(Readable.from(rawBuf));
      body = (parsed.text || '').slice(0, 4000);
      console.log(`[ai] job.${job.id} parsed body length=${body.length}`);
    }

    const subject = message.subject || '';
    const from = formatFrom(message.fromHeader);

    let result = null;
    let classificationMethod: string | null = null;
    // Try local classifier first (fast)
    try {
      result = await classifyWithLocalModel({ subject, from, body });
      if (result) {
        classificationMethod = 'local-model';
        console.log(`[ai] job.${job.id} local classifier result=${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.warn(`[ai] job.${job.id} local classifier error`, err);
      result = null;
    }

    // Fallback to LLM if local classifier unavailable or returned no category
    if (!result || !result.category) {
      try {
        console.log(`[ai] job.${job.id} calling LLM classifyWithLLM model=${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}`);
        result = await classifyWithLLM({ subject, from, body });
        classificationMethod = 'llm';
        console.log(`[ai] job.${job.id} LLM result=${JSON.stringify(result).slice(0,1000)}`);
      } catch (llmErr) {
        console.warn(`[ai] job.${job.id} LLM failed, falling back to heuristic`, llmErr);
      }
    }

    if (!result || !result.category) {
      console.log(`[ai] job.${job.id} using heuristic classifier`);
      result = heuristicClassify(subject, from, body);
      classificationMethod = 'heuristic';
      console.log(`[ai] job.${job.id} heuristic result=${JSON.stringify(result)}`);
    }

    const labels = {
      category: String(result.category || 'primary').toLowerCase(),
      spam: !!result.spam,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      cold: !!result.cold,
      categoryReason: result.reason ? String(result.reason) : null,
      method: classificationMethod || (result?.reason ? String(result.reason) : null)
    };

    console.log(`[ai] job.${job.id} updating ai_metadata id=${aiMetadataId} labels=${JSON.stringify(labels)}`);
    await prisma.$queryRaw`
      UPDATE ai_metadata
      SET labels = ${JSON.stringify(labels)}::jsonb,
          summary = NULL,
          action = NULL,
          itinerary = NULL,
          tracking = NULL,
          events = NULL,
          model = ${process.env.OPENAI_MODEL || 'gpt-4o-mini'},
          provider = ${LLM_PROVIDER_LABEL},
          raw_response = ${JSON.stringify(result)}::jsonb
      WHERE id = ${aiMetadataId}`;

    // Publish a notification so connected clients can update category/counts in real-time
    try {
      const acctRes: any = await prisma.$queryRaw`SELECT a.user_id FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} LIMIT 1`;
      const userId = Array.isArray(acctRes) && acctRes[0] ? acctRes[0].user_id : (acctRes && acctRes.user_id ? acctRes.user_id : null);
      if (userId) {
        await publishNotification({ type: 'message.updated', userId, messageId, changes: { aiLabels: labels } });
      }
    } catch (e) {
      console.warn('[ai] failed to publish message.updated notification', (e as any)?.message || e);
    }

    console.log(`[ai] job.${job.id} complete`);

    // Run summary/action immediately after classification for summarize:true categories
    if (!CATEGORIES[labels.category as keyof typeof CATEGORIES]?.summarize) {
      console.log(`[ai] job.${job.id} skipping summarize/action as per category settings`);
      return { ok: true };
    }

    await runSummaryAction(prisma, messageId, aiMetadataId, job?.id);

    return { ok: true };
  } catch (err) {
    console.error(`[ai] job.${job.id} error`, err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
};

export const aiWorkerOptions: Partial<WorkerOptions> = {
  concurrency: Number(process.env.AI_CONCURRENCY || 2),
  // increase lock duration so long LLM requests don't cause job to be considered stalled
  lockDuration: Number(process.env.AI_LOCK_DURATION_MS || 5 * 60 * 1000),
  // tweak stalled checks and allow a few retries before giving up
  stalledInterval: Number(process.env.AI_STALLED_INTERVAL_MS || 30 * 1000),
  maxStalledCount: Number(process.env.AI_MAX_STALLED_COUNT || 3)
};

// New processor: summarize message and determine recommended action (reply, click link, mark_read, archive, etc.)
async function summarizeAndActionWithLLM(input: { subject: string; from: string; body: string }) {
    const llmProvider = (process.env.LLM_PROVIDER || '').toLowerCase();
  const useCopilot = llmProvider === 'copilot';
  const base = (useCopilot ? (process.env.COPILOT_API_BASE || 'https://models.github.ai/inference') : (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1')).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const model = useCopilot ? (process.env.COPILOT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OPENAI_MODEL || 'gpt-4o-mini');
  const apiKey = useCopilot ? process.env.COPILOT_API_KEY : process.env.OPENAI_API_KEY;

  const messages = buildSummaryMessages(input);

  console.log('[ai] summarizeAndActionWithLLM calling provider=%s model=%s url=%s', useCopilot ? 'copilot' : 'openai', model, url);
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, messages })// , temperature: 0.1 })
    }, OPENAI_REQUEST_TIMEOUT_MS);
  } catch (fetchErr) {
    console.error('[ai] summarizeAndActionWithLLM fetch error', fetchErr);
    throw fetchErr;
  }

  const rawText = await res.text();
  if (!res.ok) {
    console.error(`[ai] summarizeAndActionWithLLM non-ok response status=${res.status} body=${rawText.slice(0,1000)}`);
    throw new Error(`LLM request failed: ${res.status}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (parseErr) {
    console.error('[ai] summarizeAndActionWithLLM response JSON parse failed', parseErr, `body=${rawText.slice(0,1000)}`);
    throw parseErr;
  }

  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (parsed !== null) return parsed;
  try {
    return JSON.parse(String(content).trim());
  } catch (parseErr) {
    console.error('[ai] summarizeAndActionWithLLM response content is not JSON; throwing', parseErr, `body=${String(content).slice(0,1000)}`);
    throw parseErr;
  }
}

async function runSummaryAction(prisma: PrismaService, messageId: string, aiMetadataId: string, jobId?: string | number) {
  const tag = jobId ? `job.${jobId}` : 'job';
  if ((process.env.AI_DISABLE_SUMMARY_ACTION || '').toLowerCase() === 'true') {
    console.log(`[ai-action] ${tag} summarize/action disabled via AI_DISABLE_SUMMARY_ACTION=true`);
    return { ok: true, skipped: 'disabled' };
  }
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, subject: true, fromHeader: true, raw: true } });
  if (!message) throw new Error('message not found');

  // Only process summaries/tracking for categories with summarize:true
  try {
    const metaRes: any = await prisma.$queryRaw`SELECT labels FROM ai_metadata WHERE id = ${aiMetadataId} LIMIT 1`;
    const metaRow = Array.isArray(metaRes) ? metaRes[0] : metaRes;
    const category = String(metaRow?.labels?.category || '').toLowerCase();
    const shouldSummarize = !!CATEGORIES[category as keyof typeof CATEGORIES]?.summarize;
    if (!shouldSummarize) {
      console.log(`[ai-action] ${tag} skipping summarize/action; category=${category || 'unknown'} summarize=false`);
      return { ok: true };
    }
  } catch (e) {
    console.warn(`[ai-action] ${tag} could not read ai_metadata labels, continuing`, (e as any)?.message || e);
  }

  let body = '';
  if (message.raw) {
    const rawBuf = Buffer.isBuffer(message.raw) ? message.raw : Buffer.from(message.raw as Uint8Array);
    const parsed = await simpleParser(Readable.from(rawBuf));
    body = (parsed.text || '').slice(0, 8000);
  }

  const subject = message.subject || '';
  const from = formatFrom(message.fromHeader);

  let result = null;
  try {
    result = await summarizeAndActionWithLLM({ subject, from, body });
    console.log(`[ai-action] ${tag} LLM result=${JSON.stringify(result).slice(0,1000)}`);
  } catch (llmErr) {
    console.warn(`[ai-action] ${tag} LLM failed`, llmErr);
  }

  // fallback naive summary/action
  let summary = null;
  let action: any = null;
  if (result && result.summary) {
    summary = String(result.summary).slice(0, 10000);
    action = result.action || null;
  } else {
    // take first 2 sentences from body as naive summary
    const match = body.match(/(^.*?[\.\!\?])(\s|$)/); // first sentence
    const first = match ? match[0] : (body.slice(0, 200) || subject || '');
    summary = (first + '').slice(0, 10000);
    action = { type: 'none', reason: 'could not generate recommendation' };
  }

  // process events and tracking if provided by LLM
  const events = Array.isArray(result?.events) ? result.events : [];
  const tracking = Array.isArray(result?.tracking) ? result.tracking : [];

  // insert events into events table (if any)
  if (events.length) {
    for (const ev of events) {
      try {
        const startTs = ev.start ? new Date(ev.start) : null;
        const endTs = ev.end ? new Date(ev.end) : null;
        const attendees = ev.attendees && Array.isArray(ev.attendees) ? ev.attendees : null;
        await prisma.$queryRaw`
            INSERT INTO events (message_id, ai_metadata_id, start_ts, end_ts, summary, location, attendees, source, created_at)
            VALUES (${messageId}, ${aiMetadataId}, ${startTs}, ${endTs}, ${ev.summary ?? null}, ${ev.location ?? null}, ${JSON.stringify(attendees ?? {})}::jsonb, 'llm', now())`;
      } catch (e) {
        console.warn('[ai-action] failed to insert event from LLM', (e as any)?.message || e);
      }
    }
  }

  console.log(`[ai-action] ${tag} updating ai_metadata id=${aiMetadataId} summary=${String(summary).slice(0,200)}`);
  await prisma.$queryRaw`
      UPDATE ai_metadata
      SET summary = ${summary},
          action = ${JSON.stringify(action)}::jsonb,
          itinerary = ${JSON.stringify(events)}::jsonb,
          tracking = ${JSON.stringify(tracking)}::jsonb,
          model = ${process.env.OPENAI_MODEL || 'gpt-4o-mini'},
          provider = ${LLM_PROVIDER_LABEL},
          raw_response = ${JSON.stringify({ summaryActionResult: result })}::jsonb
      WHERE id = ${aiMetadataId}`;

  console.log(`[ai-action] ${tag} complete`);
  return { ok: true };
}

export const aiActionProcessor = async (job: any) => {
  const prisma = new PrismaService();
  try {
    const { messageId, aiMetadataId } = job.data || {};
    console.log(`[ai-action] job.start id=${job.id} messageId=${messageId} aiMetadataId=${aiMetadataId}`);

    if (!messageId || !aiMetadataId) {
      console.error(`[ai-action] job.${job.id} missing params`, { messageId, aiMetadataId });
      throw new Error('messageId and aiMetadataId required');
    }

    return await runSummaryAction(prisma, messageId, aiMetadataId, job?.id);
  } catch (err) {
    console.error(`[ai-action] job.${job.id} error`, err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
};

export const aiActionWorkerOptions: Partial<WorkerOptions> = { concurrency: 1 };

export default aiJobProcessor;
