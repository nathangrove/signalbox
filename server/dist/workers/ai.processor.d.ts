import { WorkerOptions } from 'bullmq';
export declare const CATEGORIES: {
    primary: {
        prompt: string;
        heuristicKeywords: never[];
        summarize: boolean;
    };
    updates: {
        prompt: string;
        heuristicKeywords: string[];
        summarize: boolean;
    };
    social: {
        prompt: string;
        heuristicKeywords: string[];
        summarize: boolean;
    };
    newsletters: {
        prompt: string;
        heuristicKeywords: string[];
        summarize: boolean;
    };
    promotions: {
        prompt: string;
        heuristicKeywords: string[];
        summarize: boolean;
    };
    other: {
        prompt: string;
        heuristicKeywords: never[];
        summarize: boolean;
    };
};
export declare const aiJobProcessor: (job: any) => Promise<{
    ok: boolean;
}>;
export declare const aiWorkerOptions: Partial<WorkerOptions>;
export declare const aiActionProcessor: (job: any) => Promise<{
    ok: boolean;
}>;
export declare const aiActionWorkerOptions: Partial<WorkerOptions>;
export default aiJobProcessor;
