import time
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
