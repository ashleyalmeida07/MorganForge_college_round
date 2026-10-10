from fastapi import FastAPI
from app.api.routes import router as compute_router

app = FastAPI(title="Verity Backend", description="Verifiable Computation Provider API")

app.include_router(compute_router, prefix="/api")

@app.get("/")
def read_root():
    return {"message": "Welcome to the Verity FastAPI Provider Backend"}
