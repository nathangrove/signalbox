import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import * as dotenv from 'dotenv';
import { AiPromptsService } from '../src/admin/ai-prompts.service';

async function main() {
  dotenv.config();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(AiPromptsService);
  try {
    console.log('Running importCurrentPrompts...');
    const res = await svc.importCurrentPrompts();
    console.log('Import result:', res);
  } catch (err) {
    console.error('Import failed:', err);
  } finally {
    await app.close();
    process.exit(0);
  }
}

main();
