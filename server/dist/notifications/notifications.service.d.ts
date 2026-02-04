import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
export declare class NotificationsService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
    private sub;
    private readonly logger;
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
