import { DashboardService } from './dashboard.service';
export declare class DashboardController {
    private readonly svc;
    constructor(svc: DashboardService);
    get(req: any): Promise<{
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
export default DashboardController;
