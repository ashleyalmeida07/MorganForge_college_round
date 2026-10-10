import os

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content.strip())

# --- OFFCHAIN FILES ---
offchain_base = r"c:\Users\Ashley\OneDrive\Documents\Projects\bnb\offchain"

types_ts = """
export interface State {
    i: number;
    sum: bigint;
    sumSq: bigint;
}

export interface Job {
    jobId: string;
    data: bigint[];
    inputHash: string;
    reward: bigint;
    deadline: number;
}

export interface Result {
    jobId: string;
    sum: bigint;
    sumSq: bigint;
    trace: State[];
}
"""

hash_ts = """
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { State } from './types';

export function stateHash(state: State): string {
    return keccak256(
        encodeAbiParameters(
            parseAbiParameters('uint256, uint256, uint256'),
            [BigInt(state.i), state.sum, state.sumSq]
        )
    );
}

export function inputHash(data: bigint[]): string {
    return keccak256(
        encodeAbiParameters(
            [{ type: 'uint256[]' }],
            [data]
        )
    );
}
"""

compute_ts = """
import { State } from './types';

export function computeSumAndTrace(data: bigint[]): State[] {
    const trace: State[] = [];
    let currentSum = 0n;
    let currentSumSq = 0n;
    
    trace.push({
        i: 0,
        sum: currentSum,
        sumSq: currentSumSq
    });

    for (let i = 0; i < data.length; i++) {
        currentSum += data[i];
        currentSumSq += data[i] * data[i];
        
        trace.push({
            i: i + 1,
            sum: currentSum,
            sumSq: currentSumSq
        });
    }

    return trace;
}
"""

chain_adapter = """
import { Job, Result } from '../shared/types';

export interface ChainAdapter {
    acceptJob(jobId: string, providerAddress: string): Promise<void>;
    submitResult(jobId: string, result: Result): Promise<void>;
    onJobCreated(cb: (job: Job) => void): void;
}
"""

mock_chain = """
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
"""

base_provider = """
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
"""

providers = {
    "HonestProvider": """
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
""",
    "WrongResultProvider": """
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
""",
    "LazyProvider": """
import { Job, Result } from '../shared/types';
import { BaseProvider } from './BaseProvider';

export class LazyProvider extends BaseProvider {
    async run(job: Job): Promise<Result> {
        this.log('Skipping work, returning random result (INCORRECT)...');
        return { jobId: job.jobId, sum: 9999n, sumSq: 999999n, trace: [{ i: 0, sum: 0n, sumSq: 0n }] };
    }
}
""",
    "WrongInputProvider": """
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
""",
    "SlowProvider": """
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
""",
    "FlakyProvider": """
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
"""
}

registry_ts = """
import { ChainAdapter } from '../chain/ChainAdapter';
import { HonestProvider } from './HonestProvider';
import { WrongResultProvider } from './WrongResultProvider';
import { LazyProvider } from './LazyProvider';
import { WrongInputProvider } from './WrongInputProvider';
import { SlowProvider } from './SlowProvider';
import { FlakyProvider } from './FlakyProvider';
import { BaseProvider } from './BaseProvider';

export function createProvider(name: string, address: string, chain: ChainAdapter): BaseProvider {
    const map: Record<string, any> = {
        'honest': HonestProvider,
        'wrongresult': WrongResultProvider,
        'lazy': LazyProvider,
        'wronginput': WrongInputProvider,
        'slow': SlowProvider,
        'flaky': FlakyProvider
    };
    
    const ProviderClass = map[name.toLowerCase()];
    if (!ProviderClass) throw new Error(`Unknown provider: ${name}`);
    
    return new ProviderClass(name, address, chain);
}
"""

cli_ts = """
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

    console.log(`\\n--- Starting Verity Demo ---`);
    console.log(`Providers loaded: ${providersToRun.join(', ')}\\n`);

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
        console.log(`\\n--- Running Job with ${p.name} ---`);
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

    console.log(`\\n--- Demo Results ---`);
    console.table(results);
}

main().catch(console.error);
"""

test_ts = """
import { describe, it, expect } from 'vitest';
import { computeSumAndTrace } from '../shared/compute';
import { inputHash, stateHash } from '../shared/hash';

describe('Compute and Hash', () => {
    it('should compute sum and trace correctly', () => {
        const data = [5n, 10n];
        const trace = computeSumAndTrace(data);
        
        expect(trace.length).toBe(3); 
        expect(trace[0]).toEqual({ i: 0, sum: 0n, sumSq: 0n });
        expect(trace[1]).toEqual({ i: 1, sum: 5n, sumSq: 25n });
        expect(trace[2]).toEqual({ i: 2, sum: 15n, sumSq: 125n });
    });

    it('should generate deterministic state hashes', () => {
        const h1 = stateHash({ i: 1, sum: 5n, sumSq: 25n });
        const h2 = stateHash({ i: 1, sum: 5n, sumSq: 25n });
        const h3 = stateHash({ i: 2, sum: 5n, sumSq: 25n });
        
        expect(h1).toBe(h2);
        expect(h1).not.toBe(h3);
    });
});
"""

# WRITE FILES
write_file(f"{offchain_base}/shared/types.ts", types_ts)
write_file(f"{offchain_base}/shared/hash.ts", hash_ts)
write_file(f"{offchain_base}/shared/compute.ts", compute_ts)
write_file(f"{offchain_base}/chain/ChainAdapter.ts", chain_adapter)
write_file(f"{offchain_base}/chain/MockChain.ts", mock_chain)
write_file(f"{offchain_base}/providers/BaseProvider.ts", base_provider)
for name, content in providers.items():
    write_file(f"{offchain_base}/providers/{name}.ts", content)
write_file(f"{offchain_base}/providers/registry.ts", registry_ts)
write_file(f"{offchain_base}/cli.ts", cli_ts)
write_file(f"{offchain_base}/tests/compute.test.ts", test_ts)

# --- DASHBOARD COMPONENT ---
frontend_base = r"c:\Users\Ashley\OneDrive\Documents\Projects\bnb\frontend\src"

app_shell_tsx = """
import React from 'react';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col bg-gray-900 text-white font-sans">
      <header className="flex h-16 items-center justify-between border-b border-gray-800 px-6">
        <h1 className="text-xl font-bold">Verity Dashboard</h1>
        <nav className="flex space-x-4">
          <a href="#" className="text-sm font-medium hover:text-blue-400">Home</a>
          <a href="#" className="text-sm font-medium hover:text-blue-400">Settings</a>
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-6 bg-gray-800">
        {children}
      </main>
    </div>
  );
}
"""

dashboard_tsx = """
import React from 'react';

export function Dashboard() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Total Computations</h3>
          <p className="mt-2 text-3xl font-bold">1,234</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Active Disputes</h3>
          <p className="mt-2 text-3xl font-bold text-red-400">3</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Total Rewards Escrowed</h3>
          <p className="mt-2 text-3xl font-bold text-green-400">25.4 ETH</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-400">Uptime</h3>
          <p className="mt-2 text-3xl font-bold">99.9%</p>
        </div>
      </div>
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-4">Recent Jobs</h2>
        <div className="space-y-4">
          {[1, 2, 3].map((job) => (
            <div key={job} className="flex items-center justify-between border-b border-gray-800 pb-4 last:border-0 last:pb-0">
              <div>
                <p className="font-medium">Job #{job}0824</p>
                <p className="text-sm text-gray-400">Statistical Aggregate</p>
              </div>
              <div className="text-sm font-medium text-green-400 bg-green-400/10 px-3 py-1 rounded-full">Finalized</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
"""

efferd_dashboard_tsx = """
import { AppShell } from "./efferd-dashboard-2-utils/app-shell";
import { Dashboard } from "./efferd-dashboard-2-utils/dashboard";

export function EfferdDashboard2() {
  return (
    <div
      className="bg-background text-foreground"
      data-efferd-dashboard-2="true"
    >
      <AppShell>
        <Dashboard />
      </AppShell>
    </div>
  );
}

export default EfferdDashboard2;
"""

page_tsx = """
import EfferdDashboard2 from "@/components/ui/efferd-dashboard-2";

export default function DashboardPage() {
  return <EfferdDashboard2 />;
}
"""

write_file(f"{frontend_base}/components/ui/efferd-dashboard-2-utils/app-shell.tsx", app_shell_tsx)
write_file(f"{frontend_base}/components/ui/efferd-dashboard-2-utils/dashboard.tsx", dashboard_tsx)
write_file(f"{frontend_base}/components/ui/efferd-dashboard-2.tsx", efferd_dashboard_tsx)
write_file(f"{frontend_base}/app/dashboard/page.tsx", page_tsx)

print("Scaffolded offchain and dashboard files!")
