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