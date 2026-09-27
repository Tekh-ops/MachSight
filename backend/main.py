from fastapi import FastAPI

app = FastAPI(title="industrialdoctor-backend")


@app.get("/health")
def health_check():
    return {"status": "ok"}
