import { AccountsService } from './accounts.service';
export declare class AccountsController {
    private readonly svc;
    constructor(svc: AccountsService);
    list(req: any): Promise<{
        config: any;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        provider: string;
        email: string;
        encryptedCredentials: import("@prisma/client/runtime/client").Bytes;
    }[]>;
    create(req: any, body: any): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        provider: string;
        email: string;
        encryptedCredentials: import("@prisma/client/runtime/client").Bytes;
        config: import("@prisma/client/runtime/client").JsonValue | null;
    }>;
    sync(req: any, id: string): Promise<{
        ok: boolean;
    }>;
}
