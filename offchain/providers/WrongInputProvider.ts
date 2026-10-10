import { Job, Result } from '../shared/types';
import { BaseProvider } from './BaseProvider';
import { computeSumAndTrace } from '../shared/compute';

export class WrongInputProvider extends BaseProvider {
    async run(job: Job): Promise<Result> {
        this.log('Computing over modified dataset...');
        const badData = [...job.data];
        if (badData.length > 0) badData[0] += 1n; 
        
        const trace = computeSumAndTrace(badData);
        const finalState = trace[trace.length - 1];
        
        return { jobId: job.jobId, sum: finalState.sum, sumSq: finalState.sumSq, trace };
    }
}