import os
import shutil

backend_dir = r"c:\Users\Ashley\OneDrive\Documents\Projects\bnb\backend"
app_dir = os.path.join(backend_dir, "app")
models_dir = os.path.join(app_dir, "models")
services_dir = os.path.join(app_dir, "services")
api_dir = os.path.join(app_dir, "api")

# Create directories
os.makedirs(models_dir, exist_ok=True)
os.makedirs(services_dir, exist_ok=True)
os.makedirs(api_dir, exist_ok=True)

# Create __init__.py files
for d in [app_dir, models_dir, services_dir, api_dir]:
    with open(os.path.join(d, "__init__.py"), "w") as f:
        pass

# 1. Models (schemas.py)
schemas_content = """from pydantic import BaseModel
from typing import List

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
    provider_type: str = "honest"
"""
with open(os.path.join(models_dir, "schemas.py"), "w", encoding="utf-8") as f:
    f.write(schemas_content)

# 2. Services (compute.py)
compute_content = """from typing import List
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
"""
with open(os.path.join(services_dir, "compute.py"), "w", encoding="utf-8") as f:
    f.write(compute_content)

# 3. Services (providers.py)
providers_content = """import time
import random
from typing import List
from app.models.schemas import State
from app.services.compute import compute_sum_and_trace

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
        trace = compute_sum_and_trace(data)
        final = trace[-1]
        return final.sum + 1, final.sumSq, trace
"""
with open(os.path.join(services_dir, "providers.py"), "w", encoding="utf-8") as f:
    f.write(providers_content)

# 4. API (routes.py)
routes_content = """import time
from fastapi import APIRouter, HTTPException
from app.models.schemas import ComputeRequest, Result
from app.services import providers

router = APIRouter()

@router.post("/compute", response_model=Result)
def request_computation(req: ComputeRequest):
    start_time = time.time()
    
    ptype = req.provider_type.lower()
    if ptype == "honest":
        final_sum, final_sum_sq, trace = providers.run_honest(req.data)
    elif ptype == "wrongresult":
        final_sum, final_sum_sq, trace = providers.run_wrong_result(req.data)
    elif ptype == "lazy":
        final_sum, final_sum_sq, trace = providers.run_lazy(req.data)
    elif ptype == "wronginput":
        final_sum, final_sum_sq, trace = providers.run_wrong_input(req.data)
    elif ptype == "slow":
        final_sum, final_sum_sq, trace = providers.run_slow(req.data)
    elif ptype == "flaky":
        final_sum, final_sum_sq, trace = providers.run_flaky(req.data)
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
with open(os.path.join(api_dir, "routes.py"), "w", encoding="utf-8") as f:
    f.write(routes_content)

# 5. Main (main.py)
main_content = """from fastapi import FastAPI
from app.api.routes import router as compute_router

app = FastAPI(title="Verity Backend", description="Verifiable Computation Provider API")

app.include_router(compute_router, prefix="/api")

@app.get("/")
def read_root():
    return {"message": "Welcome to the Verity FastAPI Provider Backend"}
"""
with open(os.path.join(app_dir, "main.py"), "w", encoding="utf-8") as f:
    f.write(main_content)

# Remove the old main.py in the root
old_main = os.path.join(backend_dir, "main.py")
if os.path.exists(old_main):
    os.remove(old_main)

print("Backend restructured successfully.")
