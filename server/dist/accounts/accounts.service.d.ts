import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../workers/queue.service';
export declare class AccountsService {
    private readonly prisma;
    private readonly queueService;
    constructor(prisma: PrismaService, queueService: QueueService);
    private encryptConfig;
    private decryptConfig;
    listForUser(userId: string): Promise<{
        config: any;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        provider: string;
        email: string;
        encryptedCredentials: Prisma.Bytes;
    }[]>;
    createForUser(userId: string, data: any): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        provider: string;
        email: string;
        encryptedCredentials: Prisma.Bytes;
        config: Prisma.JsonValue | null;
    }>;
    syncAccount(userId: string, accountId: string): Promise<{
        ok: boolean;
    }>;
}
