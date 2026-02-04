import { MessagesService } from './messages.service';
export declare class MessagesController {
    private readonly svc;
    constructor(svc: MessagesService);
    list(req: any, mailboxId?: string, limit?: string, offset?: string, q?: string, category?: string): Promise<any[]>;
    get(req: any, id: string): Promise<{
        text: string | null;
        html: string | null;
        read: boolean;
        archived: boolean;
        category: any;
        spam: boolean;
        aiSummary: any;
        aiAction: any;
        aiItinerary: any;
        aiTracking: any;
        aiCategoryReason: any;
        aiCold: boolean;
        attachments: {
            id: string;
            sizeBytes: number | null;
            filename: string | null;
            contentType: string | null;
            contentId: string | null;
        }[];
        id: string;
        subject: string | null;
        fromHeader: import("@prisma/client/runtime/client").JsonValue;
        toHeader: import("@prisma/client/runtime/client").JsonValue;
        ccHeader: import("@prisma/client/runtime/client").JsonValue;
        internalDate: Date | null;
        sizeBytes: number | null;
        flags: string[];
        raw: Uint8Array<ArrayBuffer> | null;
    }>;
    listAttachments(req: any, id: string): Promise<{
        id: string;
        sizeBytes: number | null;
        filename: string | null;
        contentType: string | null;
        contentId: string | null;
    }[]>;
    downloadAttachment(req: any, id: string, attachmentId: string, res: any): Promise<void>;
    enqueueAi(req: any, id: string): Promise<{
        ok: boolean;
    }>;
    markRead(req: any, id: string, body: any): Promise<{
        ok: boolean;
    }>;
    setArchived(req: any, id: string, body: any): Promise<{
        ok: boolean;
    }>;
    markAllRead(req: any, body: any): Promise<{
        ok: boolean;
        updated: number;
    }>;
    archiveAll(req: any, body: any): Promise<{
        ok: boolean;
        updated: number;
    }>;
    send(req: any, body: any): Promise<{
        ok: boolean;
        info: import("nodemailer/lib/smtp-transport").SentMessageInfo;
    }>;
}
