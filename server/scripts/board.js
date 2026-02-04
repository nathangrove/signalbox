const express = require('express');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const { Queue } = require('bullmq');

const q = new Queue('fetch',{connection:{host:process.env.REDIS_HOST||'127.0.0.1',port:process.env.REDIS_PORT?Number(process.env.REDIS_PORT):6379}});
const serverAdapter = new ExpressAdapter();
createBullBoard({ queues: [new BullMQAdapter(q)], serverAdapter });
serverAdapter.setBasePath('/admin/queues');
const app = express();
app.use('/admin/queues', serverAdapter.getRouter());
app.listen(3001, ()=>console.log('Bull Board at http://localhost:3001/admin/queues'));