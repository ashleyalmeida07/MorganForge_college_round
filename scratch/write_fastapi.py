import os

file_path = r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\backend\main.py'

content = """from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
import time
import random
from eth_abi import encode
from eth_utils import keccak

app = FastAPI(title="Verity Backend", description="Verifiable Computation Provider API")

# --- Models ---
class State(BaseModel):
    i: int
    sum: int
    sumSq: int

class Result(BaseModel):
    provider: str
    sum: int
    sumSq: int
    trace: List[State]
    time_taken_ms: int

class ComputeRequest(BaseModel):
    job_id: str
    data: List[int]
    provider_type: str = "honest"  # honest, wrongresult, lazy, wronginput, slow, flaky

# --- Hashing Utility ---
def state_hash(state: State) -> str:
    encoded = encode(["uint256", "uint256", "uint256"], [state.i, state.sum, state.sumSq])
    return "0x" + keccak(encoded).hex()

# --- Compute Logic ---
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

# --- Provider Implementations ---
def run_honest(data: List[int]) -> tuple[int, int, List[State]]:
    trace = compute_sum_and_trace(data)
    final = trace[-1]
    return final.sum, final.sumSq, trace

def run_wrong_result(data: List[int]) -> tuple[int, int, List[State]]:
    trace = compute_sum_and_trace(data)
    final = trace[-1]
    return final.sum + 100, final.sumSq, trace

def run_lazy(data: List[int]) -> tuple[int, int, List[State]]:
    return 9999, 999999, [State(i=0, sum=0, sumSq=0)]

def run_wrong_input(data: List[int]) -> tuple[int, int, List[State]]:
    bad_data = data.copy()
    if bad_data:
        bad_data[0] += 1
    trace = compute_sum_and_trace(bad_data)
    final = trace[-1]
    return final.sum, final.sumSq, trace

def run_slow(data: List[int]) -> tuple[int, int, List[State]]:
    time.sleep(1.5)
    return run_honest(data)

def run_flaky(data: List[int]) -> tuple[int, int, List[State]]:
    if random.random() > 0.3:
        return run_honest(data)
    else:
        # tampered
        trace = compute_sum_and_trace(data)
        final = trace[-1]
        return final.sum + 1, final.sumSq, trace

# --- API Routes ---
@app.get("/")
def read_root():
    return {"message": "Welcome to the Verity FastAPI Provider Backend"}

@app.post("/api/compute", response_model=Result)
def request_computation(req: ComputeRequest):
    start_time = time.time()
    
    ptype = req.provider_type.lower()
    if ptype == "honest":
        final_sum, final_sum_sq, trace = run_honest(req.data)
    elif ptype == "wrongresult":
        final_sum, final_sum_sq, trace = run_wrong_result(req.data)
    elif ptype == "lazy":
        final_sum, final_sum_sq, trace = run_lazy(req.data)
    elif ptype == "wronginput":
        final_sum, final_sum_sq, trace = run_wrong_input(req.data)
    elif ptype == "slow":
        final_sum, final_sum_sq, trace = run_slow(req.data)
    elif ptype == "flaky":
        final_sum, final_sum_sq, trace = run_flaky(req.data)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider type: {req.provider_type}")
        
    time_taken = int((time.time() - start_time) * 1000)
    
    return Result(
        provider=req.provider_type,
        sum=final_sum,
        sumSq=final_sum_sq,
        trace=trace,
        time_taken_ms=time_taken
    )
"""

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Backend updated.")
