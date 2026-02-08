import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { JwtStrategy } from './jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { AccountsModule } from '../accounts/accounts.module';
import { GoogleAuthController } from './google.controller';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: '7d' }
    }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    UsersModule
    , AccountsModule
  ],
  providers: [AuthService, UsersService, JwtStrategy],
  controllers: [AuthController, GoogleAuthController],
  exports: [AuthService]
})
export class AuthModule {}
