import { MockChain } from './chain/MockChain';
import { createProvider } from './providers/registry';
import { Job } from './shared/types';
import { inputHash } from './shared/hash';
import { computeSumAndTrace } from './shared/compute';

async function main() {
    const args = process.argv.slice(2);
    const providersToRun = args.length > 0 ? args : ['honest', 'lazy', 'wrongresult'];

    const chain = new MockChain();
    
    const providers = providersToRun.map((name, idx) => {
        const p = createProvider(name, `0xPROVIDER${idx}`, chain);
        return p;
    });

    console.log(`\n--- Starting Verity Demo ---`);
    console.log(`Providers loaded: ${providersToRun.join(', ')}\n`);

    const data = [10n, 20n, 30n, 40n, 50n];
    const job: Job = {
        jobId: 'job-001',
        data,
        inputHash: inputHash(data),
        reward: 1000n,
        deadline: Date.now() + 5000
    };

    const honestTrace = computeSumAndTrace(data);
    const expectedSum = honestTrace[honestTrace.length - 1].sum;

    const results: any[] = [];
    
    for (const p of providers) {
        console.log(`\n--- Running Job with ${p.name} ---`);
        const start = Date.now();
        const res = await p.run(job);
        const timeTaken = Date.now() - start;
        
        await chain.submitResult(job.jobId, res);
        
        results.push({
            provider: p.name,
            submittedResult: res.sum.toString(),
            isCorrect: res.sum === expectedSum,
            timeTakenMs: timeTaken
        });
    }

    console.log(`\n--- Demo Results ---`);
    console.table(results);
}

main().catch(console.error);