import { Module } from '@nestjs/common';
import { MailboxesController } from './mailboxes.controller';
import { MailboxesService } from './mailboxes.service';

@Module({
  controllers: [MailboxesController],
  providers: [MailboxesService]
})
export class MailboxesModule {}
