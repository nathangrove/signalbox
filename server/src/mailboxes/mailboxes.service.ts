import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MailboxesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, accountId?: string) {
    if (accountId) {
      const rows = await this.prisma.$queryRaw`
        SELECT
          m.id,
          m.name,
          m.path,
          m.account_id AS "accountId",
          a.email AS "accountEmail",
          COUNT(msg.id) FILTER (WHERE msg.archived = false) AS "totalCount",
          COUNT(msg.id) FILTER (
            WHERE msg.archived = false
              AND msg.read = false
          ) AS "unreadCount",
          s.last_checked_at AS "lastCheckedAt",
          COALESCE((
            SELECT jsonb_object_agg(cat, cnt) FROM (
              SELECT COALESCE(am.labels->>'category','other') AS cat, COUNT(*) AS cnt
              FROM messages msg2
              LEFT JOIN ai_metadata am ON am.message_id = msg2.id AND am.version = 1
              WHERE msg2.mailbox_id = m.id
                AND msg2.read = false
                AND msg2.archived = false
              GROUP BY COALESCE(am.labels->>'category','other')
            ) s
          ), '{}'::jsonb) AS "categoryCounts"
        FROM mailboxes m
        JOIN accounts a ON a.id = m.account_id
        LEFT JOIN messages msg ON msg.mailbox_id = m.id
        LEFT JOIN sync_state s ON s.mailbox_id = m.id
        WHERE a.user_id = ${userId} AND m.account_id = ${accountId}
        GROUP BY m.id, a.email, s.last_checked_at
        ORDER BY m.account_id ASC, m.name ASC`;
      return (rows as any[]).map(row => ({
        ...row,
        totalCount: Number(row.totalCount || 0),
        unreadCount: Number(row.unreadCount || 0),
        categoryCounts: row.categoryCounts || {},
        lastCheckedAt: row.lastCheckedAt ? new Date(row.lastCheckedAt).toISOString() : null
      }));
    }

    const rows = await this.prisma.$queryRaw`
      SELECT
        m.id,
        m.name,
        m.path,
        m.account_id AS "accountId",
        a.email AS "accountEmail",
        COUNT(msg.id) FILTER (WHERE msg.archived = false) AS "totalCount",
        COUNT(msg.id) FILTER (
          WHERE msg.archived = false
            AND msg.read = false
        ) AS "unreadCount",
        s.last_checked_at AS "lastCheckedAt",
        COALESCE((
          SELECT jsonb_object_agg(cat, cnt) FROM (
            SELECT COALESCE(am.labels->>'category','other') AS cat, COUNT(*) AS cnt
            FROM messages msg2
            LEFT JOIN ai_metadata am ON am.message_id = msg2.id AND am.version = 1
            WHERE msg2.mailbox_id = m.id
              AND msg2.read = false
              AND msg2.archived = false
            GROUP BY COALESCE(am.labels->>'category','other')
          ) s
        ), '{}'::jsonb) AS "categoryCounts"
      FROM mailboxes m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN messages msg ON msg.mailbox_id = m.id
      LEFT JOIN sync_state s ON s.mailbox_id = m.id
      WHERE a.user_id = ${userId}
      GROUP BY m.id, a.email, s.last_checked_at
      ORDER BY m.account_id ASC, m.name ASC`;
    return (rows as any[]).map(row => ({
      ...row,
      totalCount: Number(row.totalCount || 0),
      unreadCount: Number(row.unreadCount || 0),
      categoryCounts: row.categoryCounts || {},
      lastCheckedAt: row.lastCheckedAt ? new Date(row.lastCheckedAt).toISOString() : null
    }));
  }
}
