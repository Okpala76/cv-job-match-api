from fastapi import FastAPI, HTTPException

from app.schemas import AnalyzeMatchRequest, AnalyzeMatchResponse
from app.rules import get_match_level, get_decision, validate_score

app = FastAPI(title="CV Job Match API")


@app.post("/analyze-match", response_model=AnalyzeMatchResponse)
def analyze_match(request: AnalyzeMatchRequest):
    job_description = request.job_description.strip()

    if not job_description:
        raise HTTPException(status_code=400, detail="Job description is required")

    try:
        score = validate_score(72)

        return {
            "match_percentage": score,
            "match_level": get_match_level(score),
            "matched_skills": ["React", "Node.js", "SQL"],
            "missing_skills": ["AWS", "Docker"],
            "tailoring_advice": "Use full-stack CV and emphasize API/database work.",
            "decision": get_decision(score),
        }

    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))
