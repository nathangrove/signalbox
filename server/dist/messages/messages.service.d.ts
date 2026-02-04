import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../workers/queue.service';
export declare class MessagesService {
    private readonly prisma;
    private readonly queueService;
    constructor(prisma: PrismaService, queueService: QueueService);
    listForUser(userId: string, mailboxId: string, limit?: number, offset?: number, query?: string, category?: string): Promise<any[]>;
    getById(userId: string, id: string): Promise<{
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
    enqueueAiForMessage(userId: string, messageId: string): Promise<{
        ok: boolean;
    }>;
    markRead(userId: string, messageId: string, read?: boolean): Promise<{
        ok: boolean;
    }>;
    setArchived(userId: string, messageId: string, archived: boolean): Promise<{
        ok: boolean;
    }>;
    listAttachments(userId: string, messageId: string): Promise<{
        id: string;
        sizeBytes: number | null;
        filename: string | null;
        contentType: string | null;
        contentId: string | null;
    }[]>;
    getAttachment(userId: string, messageId: string, attachmentId: string): Promise<{
        buffer: Buffer<ArrayBufferLike>;
        filename: string;
        contentType: string;
    }>;
    markAllRead(userId: string, mailboxId: string, category?: string | null): Promise<{
        ok: boolean;
        updated: number;
    }>;
    archiveAll(userId: string, mailboxId: string, category?: string | null): Promise<{
        ok: boolean;
        updated: number;
    }>;
    sendMail(userId: string, payload: any): Promise<{
        ok: boolean;
        info: import("nodemailer/lib/smtp-transport").SentMessageInfo;
    }>;
}
