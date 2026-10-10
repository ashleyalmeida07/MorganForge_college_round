import { Job, Result } from '../shared/types';
import { BaseProvider } from './BaseProvider';
import { computeSumAndTrace } from '../shared/compute';

export class WrongResultProvider extends BaseProvider {
    async run(job: Job): Promise<Result> {
        this.log('Computing honestly, but will alter final sum...');
        const trace = computeSumAndTrace(job.data);
        const finalState = trace[trace.length - 1];
        
        return { jobId: job.jobId, sum: finalState.sum + 100n, sumSq: finalState.sumSq, trace };
    }
}