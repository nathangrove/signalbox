import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { QueueService } from './queue.service';
export declare class ImapService implements OnModuleInit, OnModuleDestroy {
    private readonly queueService;
    private clients;
    constructor(queueService: QueueService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private startSyncForEnvAccount;
    syncAccount(accountId: string, cfg: {
        host: string;
        port?: number;
        secure?: boolean;
        auth: {
            user: string;
            pass: string;
        };
    }): Promise<void>;
}
