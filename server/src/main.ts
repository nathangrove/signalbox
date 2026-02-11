import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.create(AppModule);
  // Enable CORS for the frontend origin and allow Authorization header
  const frontend = process.env.FRONTEND_URL || '*';
  app.enableCors({
    origin: frontend === '*' ? true : frontend,
    credentials: true,
    methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','Accept','Origin','User-Agent']
  });
  app.setGlobalPrefix('v1');
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Server listening on ${await app.getUrl()}`);
}

bootstrap();
