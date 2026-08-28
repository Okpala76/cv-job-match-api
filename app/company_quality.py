from __future__ import annotations

import logging
import re
import time
from threading import Lock

from app.ai_client import AIProviderError
from app.company_research import research_company
from app.schemas import (
    AnalyzeMatchRequest,
    CompanyQualityResult,
    CompanyQualityScorecard,
    CompanyResearchResult,
)
from app.source_quality import is_credible_source

_CACHE_TTL_SECONDS = 24 * 60 * 60
logger = logging.getLogger(__name__)
_CACHE: dict[str, tuple[float, CompanyQualityResult, str]] = {}
_CACHE_LOCK = Lock()


class CompanyResearchUnavailable(RuntimeError):
    """Raised when an external company research provider fails."""


class CompanyQualityInternalError(RuntimeError):
    """Raised when company quality processing fails internally."""


def _normalize_company_name(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def evaluate_company_research(
    research: CompanyResearchResult,
    scorecard: CompanyQualityScorecard,
) -> CompanyQualityResult:
    """Enforce the final company decision deterministically in Python."""

    total_score = (
        scorecard.company_scale_score
        + scorecard.company_market_position_score
        + scorecard.company_geographic_reach_score
        + scorecard.company_engineering_maturity_score
        + scorecard.company_reputation_score
    )
    cited_sources = {evidence.source_url for evidence in research.company_evidence}
    credible_sources = {
        source
        for source in research.company_sources
        if source in cited_sources and is_credible_source(source)
    }
    reasons = list(scorecard.company_quality_reasons)

    if research.identity_ambiguous:
        decision = "Manual review"
        reasons.append("Company identity could not be resolved confidently.")
    elif research.sources_conflict:
        decision = "Manual review"
        reasons.append("Credible public sources materially conflict.")
    elif len(credible_sources) < 2:
        decision = "Manual review"
        reasons.append("Fewer than two credible grounded public sources were found.")
    elif research.confidence == "Low":
        decision = "Manual review"
        reasons.append("Grounded company research confidence is low.")
    elif total_score >= 70 and scorecard.company_scale_score >= 20:
        decision = "Accepted"
        reasons.append("Company meets the score, scale, source, and confidence gates.")
    else:
        decision = "Rejected"

        if total_score < 70:
            reasons.append("Company quality score is below 70.")

        if scorecard.company_scale_score < 20:
            reasons.append("Company scale score is below the required 20 points.")

    return CompanyQualityResult(
        **scorecard.model_dump(),
        company_quality_decision=decision,
        company_quality_score=total_score,
        company_evidence=research.company_evidence,
        company_sources=research.company_sources,
        company_confidence=research.confidence,
    )


def _manual_review_result(
    reason: str,
    research: CompanyResearchResult | None = None,
) -> CompanyQualityResult:
    return CompanyQualityResult(
        company_quality_decision="Manual review",
        company_quality_score=0,
        company_scale_score=0,
        company_market_position_score=0,
        company_geographic_reach_score=0,
        company_engineering_maturity_score=0,
        company_reputation_score=0,
        company_quality_reasons=[reason],
        company_evidence=research.company_evidence if research else [],
        company_sources=research.company_sources if research else [],
        company_confidence="Low",
    )


def clear_company_quality_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


def assess_company_quality(job: AnalyzeMatchRequest) -> CompanyQualityResult:
    """Research, score, decide, and process-cache a company's quality result."""

    cache_key = _normalize_company_name(job.company_name)

    if not cache_key:
        return _manual_review_result(
            "Company name was not provided, so public research could not run."
        )

    now = time.monotonic()

    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)

        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1].model_copy(deep=True)

        if cached:
            del _CACHE[cache_key]

    try:
        assessment = research_company(job)
    except (AIProviderError, ConnectionError, TimeoutError) as error:
        logger.exception(
            "Company research provider failed for company %r (%s): %s",
            job.company_name,
            type(error).__name__,
            error,  # noqa: TRY401
        )
        raise CompanyResearchUnavailable(
            "Company research provider is temporarily unavailable."
        ) from error
    except Exception as error:
        logger.exception(
            "Company research failed for company %r (%s): %s",
            job.company_name,
            type(error).__name__,
            error,  # noqa: TRY401
        )
        raise CompanyQualityInternalError(
            "Company research failed due to an internal error."
        ) from error

    research = assessment.research

    if not research.company_evidence or not research.company_sources:
        result = _manual_review_result(
            "Google Search grounding returned no usable cited sources.",
            research=research,
        )
    else:
        try:
            result = evaluate_company_research(research, assessment.scorecard)
        except Exception as error:
            logger.exception(
                "Company quality scoring failed for company %r (%s): %s",
                job.company_name,
                type(error).__name__,
                error,  # noqa: TRY401
            )
            raise CompanyQualityInternalError(
                "Company quality scoring failed due to an internal error."
            ) from error

    logger.info(
        "Company research completed company=%r provider=%s score=%d sources=%d "
        "decision=%s",
        cache_key,
        assessment.provider,
        result.company_quality_score,
        len(result.company_sources),
        result.company_quality_decision,
    )

    if assessment.cacheable:
        with _CACHE_LOCK:
            _CACHE[cache_key] = (
                now,
                result.model_copy(deep=True),
                assessment.provider,
            )

    return result
