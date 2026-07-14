import os

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException

from app.ai_client import analyze_cv_match
from app.schemas import AnalyzeMatchRequest, AnalyzeMatchResponse
from app.rules import get_match_level, get_decision, validate_score

load_dotenv()

app = FastAPI(title="CV Job Match API")

APP_API_KEY = os.getenv("APP_API_KEY")


def verify_api_key(x_api_key: str | None):
    if not APP_API_KEY:
        raise HTTPException(status_code=500, detail="Server API key is not configured")

    if x_api_key != APP_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.post("/analyze-match", response_model=AnalyzeMatchResponse)
def analyze_match(
    request: AnalyzeMatchRequest, x_api_key: str | None = Header(default=None)
):
    verify_api_key(x_api_key)

    job_description = request.job_description.strip()

    if (
        not job_description
        or len(job_description) < 50
        or job_description.lower() == "string"
    ):
        raise HTTPException(
            status_code=400, detail="Please provide a complete job description"
        )

    try:
        ai_result = analyze_cv_match(job_description)

        score = validate_score(ai_result.match_percentage)

        return {
            "match_percentage": score,
            "match_level": get_match_level(score),
            "matched_skills": ai_result.matched_skills,
            "missing_skills": ai_result.missing_skills,
            "tailoring_advice": ai_result.tailoring_advice,
            "decision": get_decision(score),
        }

    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(error)}")
