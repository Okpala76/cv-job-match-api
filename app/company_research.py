from __future__ import annotations

from urllib.parse import urlparse

from google.genai import types

from app.ai_client import MODEL_CANDIDATES, AIProviderError, client
from app.schemas import (
    AnalyzeMatchRequest,
    CompanyEvidence,
    CompanyResearchDraft,
    CompanyResearchResult,
)


def _usable_public_url(value: str | None) -> str | None:
    if not value:
        return None

    url = value.strip()
    parsed = urlparse(url)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None

    return url


def _extract_grounding(
    response: types.GenerateContentResponse,
) -> tuple[list[CompanyEvidence], list[str]]:
    candidates = response.candidates or []

    if not candidates or not candidates[0].grounding_metadata:
        return [], []

    metadata = candidates[0].grounding_metadata
    chunks = metadata.grounding_chunks or []
    chunk_sources: dict[int, tuple[str, str]] = {}

    for index, chunk in enumerate(chunks):
        if not chunk.web:
            continue

        url = _usable_public_url(chunk.web.uri)

        if not url:
            continue

        title = (chunk.web.title or "").strip()
        chunk_sources[index] = (url, title)

    evidence: list[CompanyEvidence] = []
    sources: list[str] = []
    seen_evidence: set[tuple[str, str]] = set()

    for support in metadata.grounding_supports or []:
        claim = ""

        if support.segment and support.segment.text:
            claim = support.segment.text.strip()

        if not claim:
            continue

        for chunk_index in support.grounding_chunk_indices or []:
            source = chunk_sources.get(chunk_index)

            if not source:
                continue

            url, title = source
            evidence_key = (claim, url)

            if evidence_key in seen_evidence:
                continue

            seen_evidence.add(evidence_key)
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

Gather factual evidence only about:
- organisational and financial scale
- market position
- geographic reach
- engineering and employer maturity
- institutional reputation

Prefer official company websites, annual reports, investor relations, stock
exchanges, regulators, government sources, reputable business publications,
and credible funding/company databases. Avoid anonymous blogs and SEO listicles.

Do not score the company and do not make an Accepted/Rejected decision. Report
whether identity is ambiguous, whether credible sources materially conflict,
and research confidence. Confidence must be Low when public evidence is too
sparse to support a reliable evaluation. Return only the requested schema.
"""


def research_company(job: AnalyzeMatchRequest) -> CompanyResearchResult:
    """Gather company facts with Google Search and retain grounding citations."""

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

            return CompanyResearchResult(
                **draft.model_dump(),
                company_evidence=evidence,
                company_sources=sources,
            )
        except Exception as error:  # noqa: BLE001
            last_error = error

    raise AIProviderError(
        f"All grounded company research models failed: {last_error}"
    ) from last_error
