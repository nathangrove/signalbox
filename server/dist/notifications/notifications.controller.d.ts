import { NotificationsGateway } from './notifications.gateway';
export declare class NotificationsController {
    private gateway;
    constructor(gateway: NotificationsGateway);
    getSockets(): {
        ok: boolean;
        message: string;
        sockets?: undefined;
    } | {
        ok: boolean;
        sockets: {
            id: any;
            rooms: unknown[];
            userId: any;
        }[];
        message?: undefined;
    };
    publish(payload: any): Promise<{
        ok: boolean;
    }>;
}
