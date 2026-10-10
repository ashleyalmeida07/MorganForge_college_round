import { Job, Result } from '../shared/types';

export interface ChainAdapter {
    acceptJob(jobId: string, providerAddress: string): Promise<void>;
    submitResult(jobId: string, result: Result): Promise<void>;
    onJobCreated(cb: (job: Job) => void): void;
}