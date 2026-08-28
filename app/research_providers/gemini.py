from __future__ import annotations

import json

from google.genai import types

from app.ai_client import (
    MODEL_CANDIDATES,
    AIProviderError,
    client,
    generate_structured_response,
)
from app.company_rubric import COMPANY_SCORE_RUBRIC
from app.research_providers.base import CompanyResearchAssessment
from app.schemas import (
    AnalyzeMatchRequest,
    CompanyEvidence,
    CompanyQualityScorecard,
    CompanyResearchDraft,
    CompanyResearchResult,
)
from app.source_quality import normalize_public_url


def _extract_grounding(
    response: types.GenerateContentResponse,
) -> tuple[list[CompanyEvidence], list[str]]:
    candidates = response.candidates or []

    if not candidates or not candidates[0].grounding_metadata:
        return [], []

    metadata = candidates[0].grounding_metadata
    chunk_sources: dict[int, tuple[str, str]] = {}

    for index, chunk in enumerate(metadata.grounding_chunks or []):
        if not chunk.web:
            continue

        url = normalize_public_url(chunk.web.uri)

        if url:
            chunk_sources[index] = (url, (chunk.web.title or "").strip())

    evidence: list[CompanyEvidence] = []
    sources: list[str] = []
    seen_evidence: set[tuple[str, str]] = set()

    for support in metadata.grounding_supports or []:
        claim = (
            support.segment.text.strip()
            if support.segment and support.segment.text
            else ""
        )

        if not claim:
            continue

        for chunk_index in support.grounding_chunk_indices or []:
            source = chunk_sources.get(chunk_index)

            if not source or (claim, source[0]) in seen_evidence:
                continue

            url, title = source
            seen_evidence.add((claim, url))

            if url not in sources:
                sources.append(url)

            evidence.append(
                CompanyEvidence(
                    claim=claim,
                    source_url=url,
                    source_title=title,
                )
            )

    return evidence, sources


def _research_prompt(job: AnalyzeMatchRequest) -> str:
    return f"""
Research the employer below using Google Search. The company name is primary;
use the job context only to disambiguate companies with similar names.

Company name: {job.company_name}
Job title: {job.job_title}
Location: {job.country_location}
Job URL: {job.job_link}
Job description: {job.job_description}

Gather factual evidence only about organisational/financial scale, market
position, geographic reach, engineering/employer maturity, and institutional
reputation. Prefer official company websites, annual reports, investor
relations, stock exchanges, regulators, government sources, reputable business
publications, and credible funding/company databases. Avoid anonymous blogs and
SEO listicles.

Do not score the company and do not make an Accepted/Rejected decision. Report
whether identity is ambiguous, whether credible sources materially conflict,
and research confidence. Confidence must be Low when public evidence is too
sparse to support a reliable evaluation. Return only the requested schema.
"""


def _score_prompt(research: CompanyResearchResult) -> str:
    grounded_payload = {
        "researched_company_name": research.researched_company_name,
        "identity_ambiguous": research.identity_ambiguous,
        "sources_conflict": research.sources_conflict,
        "confidence": research.confidence,
        "cited_evidence": [item.model_dump() for item in research.company_evidence],
    }

    return f"""
Score the grounded company research below using only its supplied facts and
sources. Do not use outside knowledge and do not make the final company gate
decision.

RUBRIC
{COMPANY_SCORE_RUBRIC}

Be conservative. Missing evidence earns no points. Reasons must identify the
strongest evidence or material weakness behind the scores.

Grounded research:
{json.dumps(grounded_payload, indent=2)}
"""


def research_with_gemini(job: AnalyzeMatchRequest) -> CompanyResearchAssessment:
    last_error: Exception | None = None

    for model in MODEL_CANDIDATES:
        try:
            response = client.models.generate_content(
                model=model,
                contents=_research_prompt(job),
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    response_mime_type="application/json",
                    response_schema=CompanyResearchDraft,
                ),
            )

            if isinstance(response.parsed, CompanyResearchDraft):
                draft = response.parsed
            elif response.parsed is not None:
                draft = CompanyResearchDraft.model_validate(response.parsed)
            elif response.text:
                draft = CompanyResearchDraft.model_validate_json(response.text)
            else:
                raise RuntimeError(f"{model} returned no company research")

            evidence, sources = _extract_grounding(response)
            research = CompanyResearchResult(
                **draft.model_dump(),
                company_evidence=evidence,
                company_sources=sources,
            )
            scorecard = CompanyQualityScorecard(
                company_scale_score=0,
                company_market_position_score=0,
                company_geographic_reach_score=0,
                company_engineering_maturity_score=0,
                company_reputation_score=0,
                company_quality_reasons=["Insufficient grounded evidence."],
            )

            if evidence and sources:
                scorecard = generate_structured_response(
                    prompt=_score_prompt(research),
                    schema_class=CompanyQualityScorecard,
                )

            return CompanyResearchAssessment(
                research=research,
                scorecard=scorecard,
                provider="gemini",
            )
        except Exception as error:  # noqa: BLE001
            last_error = error

    raise AIProviderError(
        f"All grounded company research models failed: {last_error}"
    ) from last_error
