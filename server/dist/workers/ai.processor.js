"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiActionWorkerOptions = exports.aiActionProcessor = exports.aiWorkerOptions = exports.aiJobProcessor = exports.CATEGORIES = void 0;
const prisma_service_1 = require("../prisma/prisma.service");
const mailparser_1 = require("mailparser");
const stream_1 = require("stream");
exports.CATEGORIES = {
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
function formatFrom(fromHeader) {
    try {
        const list = Array.isArray(fromHeader) ? fromHeader : [];
        if (!list.length)
            return 'unknown';
        const first = list[0];
        return first.name ? `${first.name} <${first.address}>` : (first.address || 'unknown');
    }
    catch (_) {
        return 'unknown';
    }
}
function heuristicClassify(subject, from, body) {
    const text = `${subject} ${from} ${body}`.toLowerCase();
    const spam = /(free money|winner|viagra|casino|bitcoin|crypto giveaway|act now|urgent action required)/.test(text);
    const cold = /(i am reaching out to|contacting you regarding|we would like to offer|business proposal|partnership opportunity)/.test(text);
    if (spam) {
        return { category: 'other', spam: true, confidence: 0.9, cold: false, reason: 'heuristic spam match' };
    }
    if (cold) {
        return { category: 'other', spam: false, confidence: 0.9, cold: true, reason: 'heuristic cold match' };
    }
    for (const cat of Object.keys(exports.CATEGORIES)) {
        const category = cat;
        const found = exports.CATEGORIES[category].heuristicKeywords.find(kw => text.includes(kw));
        if (found) {
            return { category, spam: false, confidence: 0.6 + Math.random() * 0.3, cold: false, reason: `matched keyword: ${found}` };
        }
    }
    return { category: 'other', spam, confidence: 0.5, cold: false, reason: 'no heuristic match' };
}
function extractJson(text) {
    if (!text || typeof text !== 'string')
        return null;
    const firstCurly = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let start = -1;
    let openChar = '';
    if (firstCurly === -1 && firstBracket === -1)
        return null;
    if (firstCurly === -1) {
        start = firstBracket;
        openChar = '[';
    }
    else if (firstBracket === -1) {
        start = firstCurly;
        openChar = '{';
    }
    else {
        start = Math.min(firstCurly, firstBracket);
        openChar = start === firstCurly ? '{' : '[';
    }
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === openChar)
            depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) {
                const candidate = text.slice(start, i + 1);
                try {
                    return JSON.parse(candidate);
                }
                catch (_) {
                    break;
                }
            }
        }
    }
    try {
        return JSON.parse(text);
    }
    catch (_) { }
    const lastClose = text.lastIndexOf(closeChar);
    if (lastClose > start) {
        try {
            return JSON.parse(text.slice(start, lastClose + 1));
        }
        catch (_) { }
    }
    return null;
}
async function classifyWithLLM(input) {
    const base = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const model = process.env.OPENAI_PARSE_MODEL || 'gpt-4o-mini';
    const apiKey = process.env.OPENAI_API_KEY;
    const messages = [
        {
            role: 'system',
            content: 'You are an email classifier. Return JSON only.'
        },
        {
            role: 'user',
            content: `Classify this email into one of: ${Object.keys(exports.CATEGORIES).map(key => `${key} (${exports.CATEGORIES[key]?.prompt})`).join(', ')}. Also set spam true/false. Determine cold true/false (whether this is a cold email).\n\n` +
                'Also set spam true/false. Determine cold true/false (whether this is a cold email). Give a one sentance reason for why you chose this category.\n\n' +
                'If there is bad grammer or the text looks obfuscated with random characters or non-english characters, it is likely spam.\n\n' +
                'Respond with a single JSON object with the most likely category: {"category":"...","spam":true|false,"confidence":0..1,"cold":true|false,"reason": "..."}.\n\n' +
                `Subject: ${input.subject}\nFrom: ${input.from}\nBody: ${input.body}`
        }
    ];
    console.log(`[ai] classifyWithLLM calling model=${model} url=${url}`);
    let res;
    try {
        res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify({ model, messages, temperature: 0.1 })
        }, OPENAI_REQUEST_TIMEOUT_MS);
    }
    catch (fetchErr) {
        console.error('[ai] classifyWithLLM fetch error', fetchErr);
        throw fetchErr;
    }
    const rawText = await res.text();
    if (!res.ok) {
        console.error(`[ai] classifyWithLLM non-ok response status=${res.status} body=${rawText.slice(0, 1000)}`);
        throw new Error(`LLM request failed: ${res.status}`);
    }
    let data;
    try {
        data = JSON.parse(rawText);
    }
    catch (parseErr) {
        console.error('[ai] classifyWithLLM response JSON parse failed', parseErr, `body=${rawText.slice(0, 1000)}`);
        throw parseErr;
    }
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content);
    if (parsed !== null)
        return parsed;
    try {
        return JSON.parse(String(content).trim());
    }
    catch (parseErr) {
        console.warn('[ai] classifyWithLLM response content is not JSON; falling back to heuristic', parseErr, `content=${String(content).slice(0, 200)}`);
        return null;
    }
}
const OPENAI_REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 60 * 1000);
async function fetchWithTimeout(url, opts = {}, timeoutMs = OPENAI_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
        return res;
    }
    finally {
        clearTimeout(id);
    }
}
const aiJobProcessor = async (job) => {
    const prisma = new prisma_service_1.PrismaService();
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
        console.log(`[ai] job.${job.id} found message id=${message.id} subject="${(message.subject || '').slice(0, 120)}"`);
        let body = '';
        if (message.raw) {
            console.log(`[ai] job.${job.id} parsing raw message`);
            const rawBuf = Buffer.isBuffer(message.raw) ? message.raw : Buffer.from(message.raw);
            const parsed = await (0, mailparser_1.simpleParser)(stream_1.Readable.from(rawBuf));
            body = (parsed.text || '').slice(0, 4000);
            console.log(`[ai] job.${job.id} parsed body length=${body.length}`);
        }
        const subject = message.subject || '';
        const from = formatFrom(message.fromHeader);
        let result = null;
        try {
            console.log(`[ai] job.${job.id} calling LLM classifyWithLLM model=${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
            result = await classifyWithLLM({ subject, from, body });
            console.log(`[ai] job.${job.id} LLM result=${JSON.stringify(result).slice(0, 1000)}`);
        }
        catch (llmErr) {
            console.warn(`[ai] job.${job.id} LLM failed, falling back to heuristic`, llmErr);
        }
        if (!result || !result.category) {
            console.log(`[ai] job.${job.id} using heuristic classifier`);
            result = heuristicClassify(subject, from, body);
            console.log(`[ai] job.${job.id} heuristic result=${JSON.stringify(result)}`);
        }
        const labels = {
            category: String(result.category || 'primary').toLowerCase(),
            spam: !!result.spam,
            confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
            cold: !!result.cold,
            categoryReason: result.reason ? String(result.reason) : null
        };
        console.log(`[ai] job.${job.id} updating ai_metadata id=${aiMetadataId} labels=${JSON.stringify(labels)}`);
        await prisma.$queryRaw `
      UPDATE ai_metadata
      SET labels = ${JSON.stringify(labels)}::jsonb,
          model = ${process.env.OPENAI_MODEL || 'gpt-4o-mini'},
          provider = ${process.env.OPENAI_API_BASE ? 'openai-compatible' : 'openai'},
          raw_response = ${JSON.stringify(result)}::jsonb
      WHERE id = ${aiMetadataId}`;
        console.log(`[ai] job.${job.id} complete`);
        if (!exports.CATEGORIES[labels.category]?.summarize) {
            console.log(`[ai] job.${job.id} skipping summarize/action as per category settings`);
            return { ok: true };
        }
        await runSummaryAction(prisma, messageId, aiMetadataId, job?.id);
        return { ok: true };
    }
    catch (err) {
        console.error(`[ai] job.${job.id} error`, err);
        throw err;
    }
    finally {
        await prisma.$disconnect();
    }
};
exports.aiJobProcessor = aiJobProcessor;
exports.aiWorkerOptions = {
    concurrency: Number(process.env.AI_CONCURRENCY || 2),
    lockDuration: Number(process.env.AI_LOCK_DURATION_MS || 5 * 60 * 1000),
    stalledInterval: Number(process.env.AI_STALLED_INTERVAL_MS || 30 * 1000),
    maxStalledCount: Number(process.env.AI_MAX_STALLED_COUNT || 3)
};
async function summarizeAndActionWithLLM(input) {
    const base = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const model = process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';
    const apiKey = process.env.OPENAI_API_KEY;
    const messages = [
        { role: 'system', content: 'You are an assistant that reads an email and returns a short (1-2 sentence) summary, a single recommended action if appropriate, any calendar event(s), and shipment tracking information. Return JSON only.' },
        { role: 'user', content: `Return a single JSON object only: {"summary":"...","action":{"type":"reply"|"click_link"|"mark_read"|"archive"|"flag"|"none","reason":"...","details":{}}, "confidence":0..1, "events":[{"summary":"..","start":"ISO8601","end":"ISO8601","location":"...","attendees":["name <email>"]}], "tracking":[{"carrier":"AMAZON|UPS|USPS|FEDEX|DHL|OTHER","trackingNumber":"...","url":"...","status":"...","deliveryDate":"ISO8601"}] }.

If no events or tracking items are found, return empty arrays for those keys.

Email:\nSubject: ${input.subject}\nFrom: ${input.from}\nBody: ${input.body}` }
    ];
    console.log('[ai] summarizeAndActionWithLLM calling model=%s url=%s', model, url);
    let res;
    try {
        res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
            },
            body: JSON.stringify({ model, messages, temperature: 0.1 })
        }, OPENAI_REQUEST_TIMEOUT_MS);
    }
    catch (fetchErr) {
        console.error('[ai] summarizeAndActionWithLLM fetch error', fetchErr);
        throw fetchErr;
    }
    const rawText = await res.text();
    if (!res.ok) {
        console.error(`[ai] summarizeAndActionWithLLM non-ok response status=${res.status} body=${rawText.slice(0, 1000)}`);
        throw new Error(`LLM request failed: ${res.status}`);
    }
    let data;
    try {
        data = JSON.parse(rawText);
    }
    catch (parseErr) {
        console.error('[ai] summarizeAndActionWithLLM response JSON parse failed', parseErr, `body=${rawText.slice(0, 1000)}`);
        throw parseErr;
    }
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content);
    if (parsed !== null)
        return parsed;
    try {
        return JSON.parse(String(content).trim());
    }
    catch (parseErr) {
        console.error('[ai] summarizeAndActionWithLLM response content is not JSON; throwing', parseErr, `body=${String(content).slice(0, 1000)}`);
        throw parseErr;
    }
}
async function runSummaryAction(prisma, messageId, aiMetadataId, jobId) {
    const tag = jobId ? `job.${jobId}` : 'job';
    const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, subject: true, fromHeader: true, raw: true } });
    if (!message)
        throw new Error('message not found');
    try {
        const metaRes = await prisma.$queryRaw `SELECT labels FROM ai_metadata WHERE id = ${aiMetadataId} LIMIT 1`;
        const metaRow = Array.isArray(metaRes) ? metaRes[0] : metaRes;
        const category = String(metaRow?.labels?.category || '').toLowerCase();
        const shouldSummarize = !!exports.CATEGORIES[category]?.summarize;
        if (!shouldSummarize) {
            console.log(`[ai-action] ${tag} skipping summarize/action; category=${category || 'unknown'} summarize=false`);
            return { ok: true };
        }
    }
    catch (e) {
        console.warn(`[ai-action] ${tag} could not read ai_metadata labels, continuing`, e?.message || e);
    }
    let body = '';
    if (message.raw) {
        const rawBuf = Buffer.isBuffer(message.raw) ? message.raw : Buffer.from(message.raw);
        const parsed = await (0, mailparser_1.simpleParser)(stream_1.Readable.from(rawBuf));
        body = (parsed.text || '').slice(0, 8000);
    }
    const subject = message.subject || '';
    const from = formatFrom(message.fromHeader);
    let result = null;
    try {
        result = await summarizeAndActionWithLLM({ subject, from, body });
        console.log(`[ai-action] ${tag} LLM result=${JSON.stringify(result).slice(0, 1000)}`);
    }
    catch (llmErr) {
        console.warn(`[ai-action] ${tag} LLM failed`, llmErr);
    }
    let summary = null;
    let action = null;
    if (result && result.summary) {
        summary = String(result.summary).slice(0, 10000);
        action = result.action || null;
    }
    else {
        const match = body.match(/(^.*?[\.\!\?])(\s|$)/);
        const first = match ? match[0] : (body.slice(0, 200) || subject || '');
        summary = (first + '').slice(0, 10000);
        action = { type: 'none', reason: 'could not generate recommendation' };
    }
    const events = Array.isArray(result?.events) ? result.events : [];
    const tracking = Array.isArray(result?.tracking) ? result.tracking : [];
    if (events.length) {
        for (const ev of events) {
            try {
                const startTs = ev.start ? new Date(ev.start) : null;
                const endTs = ev.end ? new Date(ev.end) : null;
                const attendees = ev.attendees && Array.isArray(ev.attendees) ? ev.attendees : null;
                await prisma.$queryRaw `
            INSERT INTO events (message_id, ai_metadata_id, start_ts, end_ts, summary, location, attendees, source, created_at)
            VALUES (${messageId}, ${aiMetadataId}, ${startTs}, ${endTs}, ${ev.summary ?? null}, ${ev.location ?? null}, ${JSON.stringify(attendees ?? {})}::jsonb, 'llm', now())`;
            }
            catch (e) {
                console.warn('[ai-action] failed to insert event from LLM', e?.message || e);
            }
        }
    }
    console.log(`[ai-action] ${tag} updating ai_metadata id=${aiMetadataId} summary=${String(summary).slice(0, 200)}`);
    await prisma.$queryRaw `
      UPDATE ai_metadata
      SET summary = ${summary},
          action = ${JSON.stringify(action)}::jsonb,
          itinerary = ${JSON.stringify(events)}::jsonb,
          tracking = ${JSON.stringify(tracking)}::jsonb,
          model = ${process.env.OPENAI_MODEL || 'gpt-4o-mini'},
          provider = ${process.env.OPENAI_API_BASE ? 'openai-compatible' : 'openai'},
          raw_response = ${JSON.stringify({ summaryActionResult: result })}::jsonb
      WHERE id = ${aiMetadataId}`;
    console.log(`[ai-action] ${tag} complete`);
    return { ok: true };
}
const aiActionProcessor = async (job) => {
    const prisma = new prisma_service_1.PrismaService();
    try {
        const { messageId, aiMetadataId } = job.data || {};
        console.log(`[ai-action] job.start id=${job.id} messageId=${messageId} aiMetadataId=${aiMetadataId}`);
        if (!messageId || !aiMetadataId) {
            console.error(`[ai-action] job.${job.id} missing params`, { messageId, aiMetadataId });
            throw new Error('messageId and aiMetadataId required');
        }
        return await runSummaryAction(prisma, messageId, aiMetadataId, job?.id);
    }
    catch (err) {
        console.error(`[ai-action] job.${job.id} error`, err);
        throw err;
    }
    finally {
        await prisma.$disconnect();
    }
};
exports.aiActionProcessor = aiActionProcessor;
exports.aiActionWorkerOptions = { concurrency: 1 };
exports.default = exports.aiJobProcessor;
