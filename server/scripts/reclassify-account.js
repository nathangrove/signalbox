require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Queue } = require('bullmq');

(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL required');

  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error('Usage: node server/scripts/reclassify-account.js <accountId> [--limit=5000] [--only-unlabeled] [--dry-run]');
    process.exit(1);
  }
  const accountId = args[0];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(accountId)) {
    console.error('Invalid accountId; expected a UUID. Received:', accountId);
    console.error('Tip: copy the account id exactly (no trailing characters) or pass the account email via --email=<address> (not implemented).');
    process.exit(1);
  }
  const opts = { limit: 5000, onlyUnlabeled: false, onlyHeuristic: false, dryRun: false };
  for (const a of args.slice(1)) {
    if (a.startsWith('--limit=')) opts.limit = Number(a.split('=')[1]) || opts.limit;
    if (a === '--only-unlabeled') opts.onlyUnlabeled = true;
    if (a === '--only-heuristic') opts.onlyHeuristic = true;
    if (a === '--dry-run') opts.dryRun = true;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST || '127.0.0.1';
  const redisPort = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
  const connection = redisUrl ? redisUrl : { host: redisHost, port: redisPort };
  const aiQueue = new Queue('ai', { connection });

  try {
    await prisma.$connect();

    let rows;
    if (opts.onlyUnlabeled) {
      rows = await prisma.$queryRaw`
        SELECT m.id AS message_id
        FROM messages m
        LEFT JOIN ai_metadata a ON a.message_id = m.id AND a.version = 1
        WHERE m.account_id = ${accountId} AND a.id IS NULL
        ORDER BY m.created_at DESC
        LIMIT ${opts.limit}
      `;
    } else if (opts.onlyHeuristic) {
      // Select messages that have ai_metadata with a categoryReason indicating heuristic classification
      rows = await prisma.$queryRaw`
        SELECT m.id AS message_id
        FROM messages m
        JOIN ai_metadata a ON a.message_id = m.id AND a.version = 1
        WHERE m.account_id = ${accountId}
          AND (
            lower((a.labels->>'categoryReason')) LIKE 'heuristic%'
            OR lower((a.labels->>'categoryReason')) LIKE 'matched keyword:%'
            OR lower((a.labels->>'categoryReason')) = 'no heuristic match'
          )
        ORDER BY m.created_at DESC
        LIMIT ${opts.limit}
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT m.id AS message_id
        FROM messages m
        WHERE m.account_id = ${accountId}
        ORDER BY m.created_at DESC
        LIMIT ${opts.limit}
      `;
    }

    const items = Array.isArray(rows) ? rows : [];
    console.log(`Found ${items.length} messages for account=${accountId} (limit=${opts.limit}, onlyUnlabeled=${opts.onlyUnlabeled})`);
    if (opts.dryRun) return;

    let enqueued = 0;
    for (const row of items) {
      const messageId = row.message_id;

      // Ensure ai_metadata exists for version=1
      const inserted = await prisma.$queryRaw`
        INSERT INTO ai_metadata (message_id, model, provider, created_at)
        VALUES (${messageId}, 'pending', 'local', now())
        ON CONFLICT (message_id, version) DO NOTHING
        RETURNING id
      `;

      let aiMetadataId = (inserted && inserted[0] && inserted[0].id) || null;
      if (!aiMetadataId) {
        const fallback = await prisma.$queryRaw`
          SELECT id FROM ai_metadata WHERE message_id = ${messageId} AND version = 1 LIMIT 1
        `;
        aiMetadataId = (fallback && fallback[0] && fallback[0].id) || null;
      }

      if (!aiMetadataId) continue;

      await aiQueue.add('classify-message', { messageId, aiMetadataId }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false });
      enqueued += 1;
    }

    console.log(`Enqueued ${enqueued} AI classify jobs for account=${accountId}`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    try { await aiQueue.close(); } catch (_) {}
    try { await prisma.$disconnect(); } catch (_) {}
  }
})();
