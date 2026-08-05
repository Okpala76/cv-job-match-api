import os
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

from app.ai_client import analyze_cv_match
from app.company_registry import APPROVED_COMPANY_REGISTRY
from app.opportunity_gate import evaluate_opportunity_gate
from app.rules import calculate_match_result
from app.schemas import AnalyzeMatchRequest, AnalyzeMatchResponse
from app.role_ceiling import evaluate_role_ceiling

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

        role_ceiling = evaluate_role_ceiling(request)

        if role_ceiling.role_ceiling_decision != "Accepted":
            if role_ceiling.role_ceiling_decision == "Manual review":
                advice = (
                    "Do not apply yet. Manually confirm "
                    "that this role is realistic for a "
                    "candidate with under 3 years of "
                    "experience."
                )
            else:
                advice = (
                    "Do not apply. The role is above the " "current experience ceiling."
                )

            screening_data = screening.model_dump(
                exclude={
                    "job_accepted",
                    "screening_decision",
                    "screening_reasons",
                }
            )

            return AnalyzeMatchResponse(
                **screening_data,
                job_accepted=False,
                screening_decision=(role_ceiling.role_ceiling_decision),
                screening_reasons=[
                    *screening.screening_reasons,
                    *role_ceiling.role_ceiling_reasons,
                ],
                **role_ceiling.model_dump(),
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
            **screening.model_dump(),
            **role_ceiling.model_dump(),
            match_percentage=(analysis.match_percentage),
            match_level=match_level,
            matched_skills=(analysis.matched_skills),
            missing_skills=(analysis.missing_skills),
            tailoring_advice=(analysis.tailoring_advice),
            decision=decision,
        )

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {error}",
        ) from error
