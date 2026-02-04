import { PrismaService } from '../prisma/prisma.service';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createUser(email: string, password?: string): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        passwordHash: string | null;
    }>;
    findByEmail(email: string): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        passwordHash: string | null;
    } | null>;
    validateUser(email: string, password: string): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        passwordHash: string | null;
    } | null>;
}
