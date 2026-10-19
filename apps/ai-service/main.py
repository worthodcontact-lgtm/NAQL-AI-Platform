from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

app = FastAPI(title="NAQL AI Service", version="0.1.0")

class LandedCostInput(BaseModel):
    productCost: float = 0.0
    freight: float = 0.0
    insurance: float = 0.0
    customsDutyRate: float = 0.0
    taxRate: float = 0.0
    fees: float = 0.0
    currency: str = "USD"

@app.get("/health")
def health():
    return {"status": "ok", "service": "naql-ai-service"}

@app.post("/landed-cost")
def landed_cost(payload: LandedCostInput):
    customs_duty = round(payload.productCost * payload.customsDutyRate, 2)
    subtotal = payload.productCost + payload.freight + payload.insurance + customs_duty + payload.fees
    taxes = round(subtotal * payload.taxRate, 2)
    total = round(subtotal + taxes, 2)
    return {
        "currency": payload.currency,
        "productCost": payload.productCost,
        "freight": payload.freight,
        "insurance": payload.insurance,
        "customsDuty": customs_duty,
        "taxes": taxes,
        "fees": payload.fees,
        "total": total
    }

class CopilotRequest(BaseModel):
    question: str
    context: Optional[Dict[str, Any]] = None

@app.post("/copilot/answer")
def copilot_answer(payload: CopilotRequest):
    # No model provider is configured. A fabricated answer would be worse than an
    # explicit, machine-readable unavailability signal.
    return {
        "answer": "AI provider not configured. This is a development fallback. Configure AI_PROVIDER/AI_API_KEY to enable model-backed answers.",
        "confidence": 0.0,
        "sources": [],
        "providerAvailable": False,
        "disclaimer": "Fallback, not a verified fact."
    }

@app.post("/documents/validate")
async def validate_document(file: UploadFile = File(...)):
    return {
        "filename": file.filename,
        "status": "uploaded",
        "providerAvailable": False,
        "extractedFields": {},
        "issues": ["Document extraction provider not configured; heuristic extraction unavailable."],
        "disclaimer": "Development fallback."
    }

class DelayPredictionInput(BaseModel):
    route: str
    mode: str
    departureDate: str
    carrier: Optional[str] = None

@app.post("/predict/delay")
def predict_delay(payload: DelayPredictionInput):
    # Replaceable model interface only.
    return {
        "estimatedDelayDays": 0,
        "riskLevel": "unknown",
        "method": "placeholder-interface",
        "providerAvailable": False,
        "disclaimer": "No trained model configured."
    }
