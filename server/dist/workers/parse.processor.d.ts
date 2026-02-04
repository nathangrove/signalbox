import { WorkerOptions } from 'bullmq';
export declare const parseJobProcessor: (job: any) => Promise<{
    ok: boolean;
    skipped: boolean;
} | {
    ok: boolean;
    skipped?: undefined;
}>;
export declare const parseWorkerOptions: Partial<WorkerOptions>;
export default parseJobProcessor;
