from typing import List
from eth_abi import encode
from eth_utils import keccak
from app.models.schemas import State

def state_hash(state: State) -> str:
    encoded = encode(["uint256", "uint256", "uint256"], [state.i, state.sum, state.sumSq])
    return "0x" + keccak(encoded).hex()

def compute_sum_and_trace(data: List[int]) -> List[State]:
    trace = []
    current_sum = 0
    current_sum_sq = 0
    
    trace.append(State(i=0, sum=current_sum, sumSq=current_sum_sq))
    
    for i, val in enumerate(data):
        current_sum += val
        current_sum_sq += val * val
        trace.append(State(i=i + 1, sum=current_sum, sumSq=current_sum_sq))
        
    return trace
