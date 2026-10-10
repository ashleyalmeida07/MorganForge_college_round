import { Job, Result } from '../shared/types';
import { BaseProvider } from './BaseProvider';
import { computeSumAndTrace } from '../shared/compute';

export class HonestProvider extends BaseProvider {
    async run(job: Job): Promise<Result> {
        this.log('Computing honestly...');
        const trace = computeSumAndTrace(job.data);
        const finalState = trace[trace.length - 1];
        
        return { jobId: job.jobId, sum: finalState.sum, sumSq: finalState.sumSq, trace };
    }
}