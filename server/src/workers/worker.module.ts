import { Module, Global } from '@nestjs/common';
import { QueueService } from './queue.service';
import { ImapService } from './imap.service';

@Global()
@Module({
  providers: [QueueService, ImapService],
  exports: [QueueService, ImapService]
})
export class WorkerModule {}
