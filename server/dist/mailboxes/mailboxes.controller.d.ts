import { MailboxesService } from './mailboxes.service';
export declare class MailboxesController {
    private readonly svc;
    constructor(svc: MailboxesService);
    list(req: any, accountId?: string): Promise<any[]>;
}
