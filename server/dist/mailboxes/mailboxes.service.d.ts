import { PrismaService } from '../prisma/prisma.service';
export declare class MailboxesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    listForUser(userId: string, accountId?: string): Promise<any[]>;
}
