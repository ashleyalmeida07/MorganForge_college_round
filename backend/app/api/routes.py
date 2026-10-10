import time
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
