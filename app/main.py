from fastapi import FastAPI, HTTPException

from app.ai_client import analyze_cv_match
from app.schemas import AnalyzeMatchRequest, AnalyzeMatchResponse
from app.rules import get_match_level, get_decision, validate_score

app = FastAPI(title="CV Job Match API")


@app.post("/analyze-match", response_model=AnalyzeMatchResponse)
def analyze_match(request: AnalyzeMatchRequest):
    job_description = request.job_description.strip()

    if not job_description:
        raise HTTPException(status_code=400, detail="Job description is required")

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
