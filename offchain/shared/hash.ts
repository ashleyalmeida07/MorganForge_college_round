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