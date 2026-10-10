import { ChainAdapter } from './ChainAdapter';
import { Job, Result } from '../shared/types';
import { stateHash } from '../shared/hash';

export class MockChain implements ChainAdapter {
    private jobs = new Map<string, Job>();
    private listeners: ((job: Job) => void)[] = [];

    async acceptJob(jobId: string, providerAddress: string): Promise<void> {
        console.log(`[MockChain] Job ${jobId} accepted by ${providerAddress}`);
    }

    async submitResult(jobId: string, result: Result): Promise<void> {
        console.log(`[MockChain] Result submitted for job ${jobId}. Final Sum: ${result.sum}. Trace steps: ${result.trace.length}.`);
    }

    onJobCreated(cb: (job: Job) => void): void {
        this.listeners.push(cb);
    }

    createJob(job: Job) {
        this.jobs.set(job.jobId, job);
        console.log(`[MockChain] New job created: ${job.jobId}`);
        for (const cb of this.listeners) {
            cb(job);
        }
    }
}