from pydantic import BaseModel
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
