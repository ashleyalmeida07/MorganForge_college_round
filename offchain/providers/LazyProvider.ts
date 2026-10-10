import { Job, Result } from '../shared/types';
import { BaseProvider } from './BaseProvider';

export class LazyProvider extends BaseProvider {
    async run(job: Job): Promise<Result> {
        this.log('Skipping work, returning random result (INCORRECT)...');
        return { jobId: job.jobId, sum: 9999n, sumSq: 999999n, trace: [{ i: 0, sum: 0n, sumSq: 0n }] };
    }
}