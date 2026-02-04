import 'dotenv/config';
import { OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
export declare class QueueService implements OnModuleDestroy {
    queues: Record<string, Queue>;
    workers: Worker[];
    constructor();
    createQueue(name: string): Queue<any, any, string, any, any, string>;
    onModuleDestroy(): Promise<void>;
}
