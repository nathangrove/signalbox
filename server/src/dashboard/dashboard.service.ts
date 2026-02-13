import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';

// Increase default OpenAI request timeout to 2 minutes to reduce aborts on slow/local endpoints
const OPENAI_REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 120 * 1000);

async function fetchWithTimeout(url: string, opts: any = {}, timeoutMs = OPENAI_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(id);
  }
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardForUser(userId: string) {
    // upcoming events for today + tomorrow (use a timezone-robust sliding window)
    // Use now() -12h .. now() +36h to cover "today" and "tomorrow" across common TZ offsets
    const events = await this.prisma.$queryRaw`
      SELECT e.id,
             e.message_id as "messageId",
             m.mailbox_id as "mailboxId",
             e.start_ts as "start",
             e.end_ts as "end",
             e.summary,
             e.location,
             e.attendees
      FROM events e
      JOIN messages m ON e.message_id = m.id
      JOIN accounts a ON m.account_id = a.id
      WHERE a.user_id = ${userId}
        AND e.start_ts >= now() - interval '12 hour'
        AND e.start_ts < now() + interval '36 hour'
      ORDER BY e.start_ts` as any[];

    const totalRows = await this.prisma.$queryRaw`
      SELECT count(*)::int AS cnt FROM messages m JOIN accounts a ON m.account_id = a.id WHERE a.user_id = ${userId} AND COALESCE(m.archived, false) = false` as any[];
    const unreadRows = await this.prisma.$queryRaw`
      SELECT count(*)::int AS cnt FROM messages m JOIN accounts a ON m.account_id = a.id WHERE a.user_id = ${userId} AND COALESCE(m.archived, false) = false AND m.read = false` as any[];
    const awaitingRows = await this.prisma.$queryRaw`
      SELECT count(DISTINCT m.id)::int AS cnt
      FROM messages m
      JOIN accounts a ON m.account_id = a.id
      JOIN ai_metadata am ON am.message_id = m.id AND am.version = 1
      WHERE a.user_id = ${userId} AND (am.action->>'type') = 'reply' AND COALESCE(m.archived, false) = false` as any[];

    const total = (totalRows && totalRows[0] && totalRows[0].cnt) || 0;
    const unread = (unreadRows && unreadRows[0] && unreadRows[0].cnt) || 0;
    const awaitingReply = (awaitingRows && awaitingRows[0] && awaitingRows[0].cnt) || 0;

    // counts per category (uses ai_metadata.labels->>'category') with unread totals
    const categoryRows = await this.prisma.$queryRaw`
      SELECT COALESCE(am.labels->>'category','other') AS category,
             COUNT(*)::int AS total,
             SUM(CASE WHEN m.read = false THEN 1 ELSE 0 END)::int AS unread
      FROM messages m
      JOIN accounts a ON m.account_id = a.id
      LEFT JOIN ai_metadata am ON am.message_id = m.id AND am.version = 1
      WHERE a.user_id = ${userId} AND COALESCE(m.archived, false) = false
      GROUP BY COALESCE(am.labels->>'category','other')` as any[];

    const categoryCounts: Record<string, { total: number; unread: number }> = {};
    for (const r of categoryRows || []) categoryCounts[r.category || 'other'] = { total: r.total || 0, unread: r.unread || 0 };

    // lightweight news aggregation (Hacker News + r/news) — cached in-memory for ~1 hour to avoid hitting upstream too often
    const NEWS_CACHE_TTL_MS = Number(process.env.NEWS_CACHE_TTL_MS || 60 * 60 * 1000); // default 1 hour

    // in-memory cache stored on the service instance (singleton)
    // structure: { items, fetchedAt }
    if (!(this as any)._newsCache) {
      (this as any)._newsCache = { items: [] as Array<{ title: string; url: string; source: string }>, fetchedAt: 0 };
    }
    const cache = (this as any)._newsCache as { items: Array<{ title: string; url: string; source: string }>; fetchedAt: number };

    let news: Array<{ title: string; url: string; source: string }> = [];

    const now = Date.now();
    const isCacheFresh = cache.fetchedAt && (now - cache.fetchedAt) < NEWS_CACHE_TTL_MS;
    if (isCacheFresh) {
      news = cache.items;
    } else {
      try {
        const fetched: Array<{ title: string; url: string; source: string }> = [];

        const hnRes = await fetchWithTimeout('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=6');
        if (hnRes && hnRes.ok) {
          const data = await hnRes.json();
          if (Array.isArray(data?.hits)) {
            fetched.push(...data.hits.map((h: any) => ({ title: h.title || h.story_title || '', url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, source: 'hackernews' })));
          }
        }

        const rdRes = await fetchWithTimeout('https://www.reddit.com/r/news/top.json?limit=6');
        if (rdRes && rdRes.ok) {
          const data = await rdRes.json();
          const items = (data?.data?.children || []).map((c: any) => ({ title: c.data?.title || '', url: c.data?.url || '', source: 'reddit' }));
          fetched.push(...items);
        }

        news = fetched.slice(0, 8);

        // update cache only when fetch succeeded
        if (news.length > 0) {
          cache.items = news;
          cache.fetchedAt = Date.now();
        }
      } catch (e) {
        console.warn('dashboard news fetch failed', (e as any)?.message || e);
        // fall back to cached items (even if stale) to avoid returning empty news on upstream failures
        news = cache.items || [];
      }
    }

    // Ask LLM for a two-sentence summary of the dashboard (cached by request-hash)
    let llmSummary: string | null = null;

    // configurable TTL for cached LLM responses (default: 24 hours)
    const OPENAI_CACHE_TTL_MS = Number(process.env.OPENAI_CACHE_TTL_MS || 24 * 60 * 60 * 1000);

    // initialize in-memory LLM cache on the service (singleton)
    if (!(this as any)._llmCache) {
      (this as any)._llmCache = new Map<string, { summary: string; fetchedAt: number }>();
    }
    const llmCache = (this as any)._llmCache as Map<string, { summary: string; fetchedAt: number }>;

    try {
      const llmProvider = (process.env.LLM_PROVIDER || '').toLowerCase();
      const useCopilot = llmProvider === 'copilot' || !!process.env.COPILOT_API_KEY;
      const apiKey = useCopilot ? process.env.COPILOT_API_KEY : process.env.OPENAI_API_KEY;
      const base = (useCopilot ? (process.env.COPILOT_API_BASE || 'https://models.github.ai/inference') : (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1')).replace(/\/$/, '');
      const url = `${base}/chat/completions`;
      const model = useCopilot ? (process.env.COPILOT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.OPENAI_MODEL || 'gpt-4o-mini');

      const eventsSummary = events.slice(0, 8).map((e: any) => `${new Date(e.start).toLocaleString()}: ${e.summary || ''}`).join('\n');
      const system = 'You are a concise assistant that writes a 2-sentence summary of a user dashboard. Use plain natural language.';
      const user = `Totals: ${total} messages (${unread} unread). Awaiting reply: ${awaitingReply}. Events this month:\n${eventsSummary}`;

      const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 120 };

      // hash the request body to use as cache key
      const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const cached = llmCache.get(hash);
      const nowMs = Date.now();

      if (cached && (nowMs - cached.fetchedAt) < OPENAI_CACHE_TTL_MS) {
        // replay cached response when request matches and entry is fresh
        llmSummary = cached.summary;
      } else {
        // if no fresh cache, attempt network call (but fall back to stale cache on failure)
        try {
            const res = await fetchWithTimeout(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify(body)
            }, OPENAI_REQUEST_TIMEOUT_MS);

            if (res && res.ok) {
              const text = await res.text();

              // Attempt robust extraction from different response shapes (content, text, reasoning, quoted text)
              const extractSummary = (raw: string): string | null => {
                try {
                  const parsed = JSON.parse(raw);

                  const tryChoice = (choice: any): string | null => {
                    if (!choice) return null;
                    const msg = choice.message;
                    if (msg && typeof msg.content === 'string' && msg.content.trim()) return msg.content.trim();
                    if (typeof choice.text === 'string' && choice.text.trim()) return choice.text.trim();
                    if (msg && typeof msg.reasoning === 'string' && msg.reasoning.trim()) {
                      // try to extract quoted summary from reasoning
                      const m = msg.reasoning.match(/["'“”](.{10,}?[\.\!\?])["'”]/);
                      if (m && m[1]) return m[1].trim();
                      return msg.reasoning.trim();
                    }
                    return null;
                  };

                  if (Array.isArray(parsed.choices)) {
                    for (const ch of parsed.choices) {
                      const v = tryChoice(ch);
                      if (v) return v;
                      // older/alternate APIs may put text at choice.text
                      if (typeof ch.text === 'string' && ch.text.trim()) return ch.text.trim();
                    }
                  }

                  if (typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text.trim();
                  if (typeof parsed.output === 'string' && parsed.output.trim()) return parsed.output.trim();
                } catch (err) {
                  // not JSON or unexpected shape — fall through to heuristics
                }

                // heuristics on raw string: quoted block, or first two non-empty lines
                const quoted = raw.match(/["'“”]([^"'“”]{20,})["'“”]/);
                if (quoted && quoted[1]) return quoted[1].trim();
                const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                if (lines.length >= 2) return (lines[0] + ' ' + lines[1]).slice(0, 500).trim();
                if (lines.length === 1) return lines[0].slice(0, 500).trim();
                return null;
              };

              const extracted = extractSummary(text);
              if (extracted) llmSummary = extracted;
              else llmSummary = text.slice(0, 500);

              // cache successful responses under the request hash
              if (llmSummary) {
                llmCache.set(hash, { summary: llmSummary, fetchedAt: Date.now() });
              }
            }
        } catch (e) {
          console.warn('dashboard llm summary fetch failed', (e as any)?.message || e);
          // if network failed but we have a stale cached value, use it
          if (cached) llmSummary = cached.summary;
        }
      }
    } catch (e) {
      // don't fail dashboard if LLM/cache handling errors
      console.warn('dashboard llm summary failed', (e as any)?.message || e);
    }

    return {
      counts: { total, unread, awaitingReply },
      countsByCategory: categoryCounts,
      events: events.map(e => ({ id: e.id, messageId: e.messageId, mailboxId: e.mailboxId, start: e.start, end: e.end, summary: e.summary, location: e.location, attendees: e.attendees })),
      news,
      llmSummary
    };
  }
}

export default DashboardService;
