import { Job, Result } from '../shared/types';
import { ChainAdapter } from '../chain/ChainAdapter';

export abstract class BaseProvider {
    constructor(
        public name: string,
        public address: string,
        protected chain: ChainAdapter
    ) {}

    start() {
        this.chain.onJobCreated(async (job) => {
            await this.handleJob(job);
        });
    }

    protected log(msg: string) {
        console.log(`[${this.name}] ${msg}`);
    }

    async handleJob(job: Job) {
        this.log(`Handling job ${job.jobId}`);
        await this.chain.acceptJob(job.jobId, this.address);
        
        const startTime = Date.now();
        const result = await this.run(job);
        const timeTaken = Date.now() - startTime;
        
        this.log(`Finished computation in ${timeTaken}ms. Final sum=${result.sum}`);
        
        await this.chain.submitResult(job.jobId, result);
        return { result, timeTaken };
    }

    abstract run(job: Job): Promise<Result>;
}