import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { WorkerModule } from './workers/worker.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MailboxesModule } from './mailboxes/mailboxes.module';
import { MessagesModule } from './messages/messages.module';
import { UploadsModule } from './uploads/uploads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, AccountsModule, MailboxesModule, MessagesModule, UploadsModule, NotificationsModule, WorkerModule, DashboardModule],
  controllers: [],
  providers: []
})
export class AppModule {}
