import { Controller, Post, Req, UseGuards, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import * as fs from 'fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'tmp/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function filename(req: any, file: Express.Multer.File, cb: any) {
  const rnd = randomBytes(6).toString('hex');
  const ext = extname(file.originalname) || '';
  cb(null, `${Date.now()}-${rnd}${ext}`);
}

@Controller('uploads')
export class UploadsController {
  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: UPLOAD_DIR, filename }),
      limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024) }
    })
  )
  async upload(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file required');
    // Return path that can be referenced by outbound job payload
    const rel = `${UPLOAD_DIR}/${file.filename}`;
    return { ok: true, filename: file.originalname, contentType: file.mimetype, size: file.size, path: rel };
  }
}
