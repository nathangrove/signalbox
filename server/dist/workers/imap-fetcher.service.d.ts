import { OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
export declare class ImapFetcherService implements OnModuleDestroy {
    private readonly prisma;
    private fetchQueue;
    constructor(prisma: PrismaService);
    fetchAccountHeaders(accountId: string): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
