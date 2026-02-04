"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
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
let DashboardService = class DashboardService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getDashboardForUser(userId) {
        const events = await this.prisma.$queryRaw `
      SELECT e.id, e.start_ts as "start", e.end_ts as "end", e.summary, e.location, e.attendees
      FROM events e
      JOIN messages m ON e.message_id = m.id
      JOIN accounts a ON m.account_id = a.id
      WHERE a.user_id = ${userId}
        AND e.start_ts >= date_trunc('month', now())
        AND e.start_ts < date_trunc('month', now()) + interval '1 month'
      ORDER BY e.start_ts`;
        const totalRows = await this.prisma.$queryRaw `
      SELECT count(*)::int AS cnt FROM messages m JOIN accounts a ON m.account_id = a.id WHERE a.user_id = ${userId} AND m.archived = false`;
        const unreadRows = await this.prisma.$queryRaw `
      SELECT count(*)::int AS cnt FROM messages m JOIN accounts a ON m.account_id = a.id WHERE a.user_id = ${userId} AND m.archived = false AND m.read = false`;
        const awaitingRows = await this.prisma.$queryRaw `
      SELECT count(DISTINCT m.id)::int AS cnt
      FROM messages m
      JOIN accounts a ON m.account_id = a.id
      JOIN ai_metadata am ON am.message_id = m.id AND am.version = 1
      WHERE a.user_id = ${userId} AND (am.action->>'type') = 'reply' AND m.archived = false`;
        const total = (totalRows && totalRows[0] && totalRows[0].cnt) || 0;
        const unread = (unreadRows && unreadRows[0] && unreadRows[0].cnt) || 0;
        const awaitingReply = (awaitingRows && awaitingRows[0] && awaitingRows[0].cnt) || 0;
        let llmSummary = null;
        try {
            const apiKey = process.env.OPENAI_API_KEY;
            if (apiKey) {
                const base = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
                const url = `${base}/chat/completions`;
                const model = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
                const eventsSummary = events.slice(0, 8).map((e) => `${new Date(e.start).toLocaleString()}: ${e.summary || ''}`).join('\n');
                const system = 'You are a concise assistant that writes a 2-sentence summary of a user dashboard. Use plain natural language.';
                const user = `Totals: ${total} messages (${unread} unread). Awaiting reply: ${awaitingReply}. Events this month:\n${eventsSummary}`;
                const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 120 };
                const res = await fetchWithTimeout(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify(body)
                });
                if (res && res.ok) {
                    const text = await res.text();
                    try {
                        const data = JSON.parse(text);
                        llmSummary = (data?.choices?.[0]?.message?.content || '').trim();
                    }
                    catch (_) {
                        llmSummary = (await res.text()).slice(0, 500);
                    }
                }
            }
        }
        catch (e) {
            console.warn('dashboard llm summary failed', e?.message || e);
        }
        return {
            counts: { total, unread, awaitingReply },
            events: events.map(e => ({ id: e.id, start: e.start, end: e.end, summary: e.summary, location: e.location, attendees: e.attendees })),
            llmSummary
        };
    }
};
exports.DashboardService = DashboardService;
exports.DashboardService = DashboardService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DashboardService);
exports.default = DashboardService;
