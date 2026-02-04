import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../workers/queue.service';
import { decryptJson, encryptJson } from '../utils/crypto';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService
  ) {}

  private encryptConfig(config: any): Buffer {
    return encryptJson(config);
  }

  private decryptConfig(encrypted: Uint8Array): any {
    return decryptJson(encrypted);
  }

  async listForUser(userId: string) {
    const accounts = await this.prisma.account.findMany({ where: { userId } });
    return accounts.map(account => ({
      ...account,
      config: account.encryptedCredentials && account.encryptedCredentials.length
        ? this.decryptConfig(account.encryptedCredentials)
        : {},
    }));
  }

  async createForUser(userId: string, data: any) {
    const { config, ...rest } = data;
    const encryptedCredentials = config ? this.encryptConfig(config) : Buffer.alloc(0);
    let account;
    try {
      account = await this.prisma.account.create({
        data: {
          userId,
          ...rest,
          encryptedCredentials,
          config: {}, // Store empty config, credentials are encrypted
        },
      });
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Unique constraint failed (email)
        throw new ConflictException('An account with that email already exists');
      }
      throw e;
    }
    await this.queueService.queues.fetch.add(
      'fetch-account',
      { accountId: account.id },
      { removeOnComplete: true, removeOnFail: false }
    );
    return account;
  }

  async updateForUser(userId: string, accountId: string, data: any) {
    const { config, ...rest } = data || {};
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new ConflictException('Account not found');
    // If a config patch is provided, decrypt existing credentials (if any), merge, and re-encrypt.
    let encryptedCredentials: Buffer | undefined = undefined;
    if (typeof config !== 'undefined' && config !== null) {
      let currentConfig: any = {};
      try {
        if (account.encryptedCredentials && account.encryptedCredentials.length) {
          currentConfig = this.decryptConfig(account.encryptedCredentials as Uint8Array) || {};
        }
      } catch (_) { currentConfig = {}; }
      const merged = Object.assign({}, currentConfig, config || {});
      encryptedCredentials = this.encryptConfig(merged);
    }

    try {
      const updated = await this.prisma.account.update({
        where: { id: accountId },
        data: Object.assign({}, rest, encryptedCredentials ? { encryptedCredentials } : {})
      });

      return {
        ...updated,
        config: updated.encryptedCredentials && updated.encryptedCredentials.length ? this.decryptConfig(updated.encryptedCredentials) : {}
      };
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An account with that email already exists');
      }
      throw e;
    }
  }

  async syncAccount(userId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new ConflictException('Account not found');
    await this.queueService.queues.fetch.add(
      'fetch-account',
      { accountId: account.id },
      { removeOnComplete: true, removeOnFail: false }
    );
    return { ok: true };
  }
}