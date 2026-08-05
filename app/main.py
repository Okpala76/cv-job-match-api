import os
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

from app.ai_client import analyze_cv_match
from app.company_registry import APPROVED_COMPANY_REGISTRY
from app.opportunity_gate import evaluate_opportunity_gate
from app.rules import calculate_match_result
from app.schemas import AnalyzeMatchRequest, AnalyzeMatchResponse

app = FastAPI(title="CV Job Match API")

APP_API_KEY = os.getenv("APP_API_KEY")


def verify_api_key(x_api_key: str | None) -> None:
    if not APP_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server API key is not configured",
        )

    if x_api_key != APP_API_KEY:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key",
        )


@app.get("/health")
def health_check() -> dict[str, str | int]:
    return {
        "status": "ok",
        "approved_company_count": APPROVED_COMPANY_REGISTRY.company_count,
    }


@app.post(
    "/analyze-match",
    response_model=AnalyzeMatchResponse,
)
def analyze_match(
    request: AnalyzeMatchRequest,
    x_api_key: Annotated[str | None, Header(alias="x-api-key")] = None,
) -> AnalyzeMatchResponse:
    verify_api_key(x_api_key)

    try:
        screening = evaluate_opportunity_gate(request)

        if not screening.job_accepted:
            advice = (
                "Do not apply yet. Confirm the company or compensation."
                if screening.screening_decision == "Manual review"
                else "Do not apply. The opportunity failed the company/salary gate."
            )

            return AnalyzeMatchResponse(
                **screening.model_dump(),
                match_percentage=None,
                match_level=None,
                matched_skills=[],
                missing_skills=[],
                tailoring_advice=advice,
                decision="Skip",
            )

        # Batch 3 will add the role-ceiling gate here, before CV matching.
        analysis = analyze_cv_match(request.job_description)
        match_level, decision = calculate_match_result(analysis.match_percentage)

        return AnalyzeMatchResponse(
            **screening.model_dump(),
            match_percentage=analysis.match_percentage,
            match_level=match_level,
            matched_skills=analysis.matched_skills,
            missing_skills=analysis.missing_skills,
            tailoring_advice=analysis.tailoring_advice,
            decision=decision,
        )

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {error}",
        ) from error
