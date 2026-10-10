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