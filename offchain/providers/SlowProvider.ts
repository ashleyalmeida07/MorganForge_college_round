import { Job, Result } from '../shared/types';
import { BaseProvider } from './BaseProvider';
import { computeSumAndTrace } from '../shared/compute';

export class SlowProvider extends BaseProvider {
    async run(job: Job): Promise<Result> {
        this.log('Computing... will be intentionally slow.');
        await new Promise(resolve => setTimeout(resolve, 1500)); 
        
        const trace = computeSumAndTrace(job.data);
        const finalState = trace[trace.length - 1];
        
        return { jobId: job.jobId, sum: finalState.sum, sumSq: finalState.sumSq, trace };
    }
}