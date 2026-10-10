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