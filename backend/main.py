from fastapi import FastAPI
import db

app = FastAPI(title="industrialdoctor-backend")


@app.get("/health")
def health_check():
    return {"status": "ok"}
