import { PrismaService } from '../prisma/prisma.service';
export declare class DashboardService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getDashboardForUser(userId: string): Promise<{
        counts: {
            total: any;
            unread: any;
            awaitingReply: any;
        };
        events: {
            id: any;
            start: any;
            end: any;
            summary: any;
            location: any;
            attendees: any;
        }[];
        llmSummary: string | null;
    }>;
}
export default DashboardService;
