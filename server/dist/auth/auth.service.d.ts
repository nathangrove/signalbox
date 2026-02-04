import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
export declare class AuthService {
    private usersService;
    private jwtService;
    constructor(usersService: UsersService, jwtService: JwtService);
    validateUser(email: string, pass: string): Promise<{
        id: string;
        createdAt: Date;
        email: string;
        passwordHash: string | null;
    }>;
    login(user: any): Promise<{
        access_token: string;
    }>;
    register(email: string, password: string): Promise<{
        access_token: string;
    }>;
}
