import os

from fastapi import FastAPI, HTTPException

from app.ai_client import analyze_cv_match, screen_job_quality
from app.schemas import (
    AnalyzeMatchRequest,
    AnalyzeMatchResponse,
)
from app.rules import (
    calculate_match_result,
    calculate_screening_decision,
    find_hard_rejection_reason,
)
from app.ai_client import analyze_cv_match, screen_job_quality
from app.schemas import (
    AnalyzeMatchRequest,
    AnalyzeMatchResponse,
)
from app.rules import (
    calculate_match_result,
    calculate_screening_decision,
    find_hard_rejection_reason,
)

app = FastAPI(title="CV Job Match API")

APP_API_KEY = os.getenv("APP_API_KEY")


def verify_api_key(x_api_key: str | None):
    if not APP_API_KEY:
        raise HTTPException(status_code=500, detail="Server API key is not configured")

    if x_api_key != APP_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
    }


@app.post(
    "/analyze-match",
    response_model=AnalyzeMatchResponse,
)
def analyze_match(
    request: AnalyzeMatchRequest,
) -> AnalyzeMatchResponse:
    try:
        hard_rejection_reason = find_hard_rejection_reason(request)

        if hard_rejection_reason:
            return AnalyzeMatchResponse(
                job_accepted=False,
                screening_decision="Rejected",
                screening_reasons=[hard_rejection_reason],
                salary_status="Unknown",
                job_quality_level="Not high-end",
                match_percentage=None,
                match_level=None,
                matched_skills=[],
                missing_skills=[],
                tailoring_advice=(
                    "Do not apply. This role does not meet the "
                    "high-end job requirement."
                ),
                decision="Skip",
            )

        screening = screen_job_quality(request)

        screening_decision = calculate_screening_decision(screening)

        if screening_decision != "Accepted":
            if screening_decision == "Manual review":
                advice = (
                    "Do not apply yet. Confirm the role seniority "
                    "and compensation before continuing."
                )
            else:
                advice = (
                    "Do not apply. This job did not pass the "
                    "high-end and high-paying screening requirements."
                )

            return AnalyzeMatchResponse(
                job_accepted=False,
                screening_decision=screening_decision,
                screening_reasons=screening.screening_reasons,
                salary_status=screening.salary_status,
                job_quality_level=screening.job_quality_level,
                match_percentage=None,
                match_level=None,
                matched_skills=[],
                missing_skills=[],
                tailoring_advice=advice,
                decision="Skip",
            )

        analysis = analyze_cv_match(request.job_description)

        match_level, decision = calculate_match_result(analysis.match_percentage)

        return AnalyzeMatchResponse(
            job_accepted=True,
            screening_decision="Accepted",
            screening_reasons=screening.screening_reasons,
            salary_status=screening.salary_status,
            job_quality_level=screening.job_quality_level,
            match_percentage=analysis.match_percentage,
            match_level=match_level,
            matched_skills=analysis.matched_skills,
            missing_skills=analysis.missing_skills,
            tailoring_advice=analysis.tailoring_advice,
            decision=decision,
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {error}",
        ) from error
