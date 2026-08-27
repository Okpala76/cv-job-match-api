from __future__ import annotations

import json
import logging
import re
import time
from threading import Lock
from urllib.parse import urlparse

from app.ai_client import AIProviderError, generate_structured_response
from app.company_research import research_company
from app.schemas import (
    AnalyzeMatchRequest,
    CompanyQualityResult,
    CompanyQualityScorecard,
    CompanyResearchResult,
)

_CACHE_TTL_SECONDS = 24 * 60 * 60
logger = logging.getLogger(__name__)
_CACHE: dict[str, tuple[float, CompanyQualityResult]] = {}
_CACHE_LOCK = Lock()
_LOW_CREDIBILITY_HOSTS = {
    "blogspot.com",
    "facebook.com",
    "medium.com",
    "quora.com",
    "reddit.com",
    "twitter.com",
    "wordpress.com",
    "x.com",
}


class CompanyResearchUnavailable(RuntimeError):
    """Raised when an external company research provider fails."""


class CompanyQualityInternalError(RuntimeError):
    """Raised when company quality processing fails internally."""


def _normalize_company_name(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def _is_credible_source(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()

    if not hostname:
        return False

    return not any(
        hostname == blocked or hostname.endswith(f".{blocked}")
        for blocked in _LOW_CREDIBILITY_HOSTS
    )


def _score_prompt(research: CompanyResearchResult) -> str:
    grounded_payload = {
        "researched_company_name": research.researched_company_name,
        "identity_ambiguous": research.identity_ambiguous,
        "sources_conflict": research.sources_conflict,
        "confidence": research.confidence,
        "cited_evidence": [
            evidence.model_dump() for evidence in research.company_evidence
        ],
    }

    return f"""
Score the grounded company research below using only its supplied facts and
sources. Do not use outside knowledge and do not make the final company gate
decision.

RUBRIC
Organisational / Financial Scale (0-30):
0 little/no meaningful scale; 10 established small/medium; 20 clearly
substantial; 30 very large, major corporate, or strongly capitalised.

Market Position (0-25):
0 weak/no evidence; 10 established participant; 18 significant sector player;
25 clear leading/top-tier market position.

Geographic Reach (0-15):
0 very limited/local; 5 meaningful national; 10 multi-country/regional;
15 major African or international presence.

Engineering / Employer Maturity (0-20):
0 little evidence; 8 established professional employer; 14 clear technology or
engineering capability; 20 mature engineering/technology organisation.

Institutional Reputation (0-10):
0 weak/unverifiable; 5 credible established organisation; 10 highly
established/institutional organisation.

Be conservative. Missing evidence earns no points. Reasons must identify the
strongest evidence or material weakness behind the scores.

Grounded research:
{json.dumps(grounded_payload, indent=2)}
"""


def score_company_research(
    research: CompanyResearchResult,
) -> CompanyQualityScorecard:
    """Have Gemini map grounded facts onto the application-owned rubric."""

    return generate_structured_response(
        prompt=_score_prompt(research),
        schema_class=CompanyQualityScorecard,
    )


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
        if source in cited_sources and _is_credible_source(source)
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
        research = research_company(job)
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

    if not research.company_evidence or not research.company_sources:
        result = _manual_review_result(
            "Google Search grounding returned no usable cited sources.",
            research=research,
        )
    else:
        try:
            scorecard = score_company_research(research)
            result = evaluate_company_research(research, scorecard)
        except AIProviderError as error:
            logger.exception(
                "Company quality provider failed for company %r (%s): %s",
                job.company_name,
                type(error).__name__,
                error,  # noqa: TRY401
            )
            raise CompanyResearchUnavailable(
                "Company research provider is temporarily unavailable."
            ) from error
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

    with _CACHE_LOCK:
        _CACHE[cache_key] = (now, result.model_copy(deep=True))

    return result
