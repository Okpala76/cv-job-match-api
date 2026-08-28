from __future__ import annotations

import logging
from dataclasses import replace

from app.ai_client import AIProviderError
from app.research_providers.base import CompanyResearchAssessment
from app.research_providers.gemini import research_with_gemini
from app.research_providers.serper_groq import research_with_serper_groq
from app.schemas import AnalyzeMatchRequest
from app.source_quality import is_credible_source

logger = logging.getLogger(__name__)


def _is_conclusive(assessment: CompanyResearchAssessment) -> bool:
    research = assessment.research
    cited_sources = {item.source_url for item in research.company_evidence}
    credible_sources = {
        source
        for source in research.company_sources
        if source in cited_sources and is_credible_source(source)
    }
    return (
        not research.identity_ambiguous
        and not research.sources_conflict
        and research.confidence != "Low"
        and len(credible_sources) >= 2
    )


def research_company(job: AnalyzeMatchRequest) -> CompanyResearchAssessment:
    """Run Serper/Groq first and use Gemini only as a useful fallback."""

    primary: CompanyResearchAssessment | None = None
    try:
        primary = research_with_serper_groq(job)
    except (AIProviderError, ConnectionError, TimeoutError) as error:
        logger.exception(
            "Primary company research failed for company %r (%s): %s; "
            "trying Gemini",
            job.company_name,
            type(error).__name__,
            error,  # noqa: TRY401
        )
    else:
        if _is_conclusive(primary):
            return primary

        logger.info(
            "Primary company research was inconclusive for company %r; trying Gemini",
            job.company_name,
        )

    try:
        return research_with_gemini(job)
    except (AIProviderError, ConnectionError, TimeoutError) as fallback_error:
        if primary is not None:
            logger.exception(
                "Gemini fallback failed for company %r (%s): %s; using "
                "completed inconclusive primary research",
                job.company_name,
                type(fallback_error).__name__,
                fallback_error,  # noqa: TRY401
            )
            return replace(primary, cacheable=False)

        raise AIProviderError(
            "Serper/Groq and Gemini company research providers are unavailable"
        ) from fallback_error
