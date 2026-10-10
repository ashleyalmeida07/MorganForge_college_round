import { Job, Result } from '../shared/types';
import { BaseProvider } from './BaseProvider';
import { computeSumAndTrace } from '../shared/compute';

export class FlakyProvider extends BaseProvider {
    async run(job: Job): Promise<Result> {
        const isHonest = Math.random() > 0.3; 
        this.log(`Rolling the dice... isHonest=${isHonest}`);
        
        const trace = computeSumAndTrace(job.data);
        const finalState = trace[trace.length - 1];
        
        return { 
            jobId: job.jobId, 
            sum: isHonest ? finalState.sum : finalState.sum + 1n, 
            sumSq: finalState.sumSq, 
            trace 
        };
    }
}