from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse

import requests
from groq import Groq
from pydantic import BaseModel, ConfigDict, Field

from app.ai_client import AIProviderError
from app.company_rubric import COMPANY_SCORE_RUBRIC
from app.research_providers.base import CompanyResearchAssessment
from app.schemas import (
    AnalyzeMatchRequest,
    CompanyEvidence,
    CompanyQualityScorecard,
    CompanyResearchResult,
)
from app.source_quality import is_credible_source, normalize_public_url

SERPER_URL = "https://google.serper.dev/search"
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
_REQUEST_TIMEOUT_SECONDS = 6
_MAX_ATTEMPTS = 2
_MAX_EVIDENCE_RESULTS = 10
_STRICT_GROQ_MODELS = {
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "qwen/qwen3.8-27b",
}
_LOW_QUALITY_RESULT_PHRASES = (
    "best companies to",
    "list of companies",
    "top 10 companies",
    "top companies in",
)


@dataclass(frozen=True)
class SearchEvidence:
    title: str
    url: str
    snippet: str
    source: str
    query: str


class GroqEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str = Field(min_length=1)
    source_url: str = Field(min_length=1)
    source_title: str


class GroqCompanyEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolved_company_name: str = Field(min_length=1)
    identity_ambiguous: bool
    source_conflict: bool
    company_scale_score: int = Field(ge=0, le=30)
    company_market_position_score: int = Field(ge=0, le=25)
    company_geographic_reach_score: int = Field(ge=0, le=15)
    company_engineering_maturity_score: int = Field(ge=0, le=20)
    company_reputation_score: int = Field(ge=0, le=10)
    confidence: Literal["High", "Medium", "Low"]
    reasons: list[str] = Field(min_length=1)
    evidence: list[GroqEvidence]


def build_search_queries(job: AnalyzeMatchRequest) -> list[str]:
    company = f'"{job.company_name.strip()}"'
    context = f' "{job.country_location.strip()}"' if job.country_location.strip() else ""

    return [
        f"{company} employees revenue assets funding company profile{context}",
        f"{company} market leader operations countries Africa customers{context}",
        f"{company} engineering technology software careers jobs{context}",
    ]


def _transient_status(status_code: int) -> bool:
    return status_code == 429 or status_code >= 500


def _search_serper(query: str) -> list[dict]:
    api_key = os.getenv("SERPER_API_KEY")

    if not api_key:
        raise AIProviderError("SERPER_API_KEY is not configured")

    last_error: Exception | None = None

    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = requests.post(
                SERPER_URL,
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json={"q": query, "num": 10},
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )

            if response.status_code == 200:
                payload = response.json()

                if not isinstance(payload, dict):
                    raise ValueError("Serper returned a non-object response")

                organic = payload.get("organic", [])

                if not isinstance(organic, list):
                    raise ValueError("Serper returned invalid organic results")

                return organic

            if not _transient_status(response.status_code):
                raise AIProviderError(
                    f"Serper request failed with HTTP {response.status_code}"
                )

            last_error = RuntimeError(
                f"Serper request failed with HTTP {response.status_code}"
            )
        except (requests.RequestException, ValueError) as error:
            last_error = error

        if attempt + 1 < _MAX_ATTEMPTS:
            time.sleep(0.25 * (2**attempt))

    raise AIProviderError(f"Serper search failed: {last_error}") from last_error


def _source_rank(item: SearchEvidence) -> tuple[int, int]:
    hostname = (urlparse(item.url).hostname or "").lower()
    text = f"{hostname} {item.title} {item.snippet}".lower()
    rank = 0

    if any(token in text for token in ("annual report", "investor", "official")):
        rank += 50
    if any(token in text for token in ("regulator", "stock exchange", ".gov")):
        rank += 45
    if any(token in hostname for token in ("reuters.com", "bloomberg.com")):
        rank += 35
    if any(token in hostname for token in ("crunchbase.com", "linkedin.com")):
        rank += 15
    if is_credible_source(item.url):
        rank += 20

    return rank, len(item.snippet)


def _obvious_low_quality_result(item: SearchEvidence) -> bool:
    text = f"{item.title} {item.snippet}".lower()
    return any(phrase in text for phrase in _LOW_QUALITY_RESULT_PHRASES)


def normalize_search_results(
    results_by_query: list[tuple[str, list[dict]]],
) -> list[SearchEvidence]:
    deduplicated: dict[str, SearchEvidence] = {}

    for query, results in results_by_query:
        for result in results:
            if not isinstance(result, dict):
                continue

            url = normalize_public_url(result.get("link"))

            if not url or url in deduplicated:
                continue

            deduplicated[url] = SearchEvidence(
                title=str(result.get("title") or "").strip(),
                url=url,
                snippet=str(result.get("snippet") or "").strip(),
                source=(urlparse(url).hostname or "").lower(),
                query=query,
            )

    ranked = sorted(deduplicated.values(), key=_source_rank, reverse=True)
    credible = [item for item in ranked if is_credible_source(item.url)]
    strong = [item for item in credible if not _obvious_low_quality_result(item)]
    selected = strong or credible or ranked
    return selected[:_MAX_EVIDENCE_RESULTS]


def _evaluation_prompt(job: AnalyzeMatchRequest, evidence: list[SearchEvidence]) -> str:
    payload = [item.__dict__ for item in evidence]
    return f"""
Evaluate the company using ONLY the supplied Serper search evidence. Extract
facts and score the five rubric components, but do not make the final
Accepted/Rejected decision.

Rules:
- Never use unstated internal knowledge.
- Never invent financial figures, employee counts, claims, or URLs.
- Every evidence source_url must exactly match a supplied URL.
- Treat missing evidence as missing and score conservatively.
- Distinguish similarly named companies.
- Job context is only for company identity disambiguation.
- Do not judge the candidate.
- Report identity ambiguity, material source conflict, and confidence.

Company: {job.company_name}
Job title: {job.job_title}
Location: {job.country_location}
Job URL: {job.job_link}

Rubric:
{COMPANY_SCORE_RUBRIC}

Supplied evidence:
{json.dumps(payload, indent=2)}
"""


def _evaluate_with_groq(
    job: AnalyzeMatchRequest,
    evidence: list[SearchEvidence],
) -> GroqCompanyEvaluation:
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise AIProviderError("GROQ_API_KEY is not configured")

    try:
        client = Groq(
            api_key=api_key,
            max_retries=0,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as error:
        raise AIProviderError(f"Groq client setup failed: {error}") from error
    last_error: Exception | None = None

    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": "Return a strict evidence-based company evaluation.",
                    },
                    {"role": "user", "content": _evaluation_prompt(job, evidence)},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "company_research_evaluation",
                        "strict": GROQ_MODEL in _STRICT_GROQ_MODELS,
                        "schema": GroqCompanyEvaluation.model_json_schema(),
                    },
                },
                temperature=0,
            )
            content = response.choices[0].message.content

            if not content:
                raise ValueError("Groq returned no structured company evaluation")

            return GroqCompanyEvaluation.model_validate_json(content)
        except Exception as error:  # noqa: BLE001
            last_error = error
            status_code = getattr(error, "status_code", None)

            if status_code is not None and not _transient_status(status_code):
                break

        if attempt + 1 < _MAX_ATTEMPTS:
            time.sleep(0.25 * (2**attempt))

    raise AIProviderError(f"Groq evaluation failed: {last_error}") from last_error


def _normalize_evaluation(
    evaluation: GroqCompanyEvaluation,
    supplied_evidence: list[SearchEvidence],
) -> CompanyResearchAssessment:
    supplied_urls = {item.url: item for item in supplied_evidence}
    evidence: list[CompanyEvidence] = []
    sources: list[str] = []
    seen: set[tuple[str, str]] = set()

    for item in evaluation.evidence:
        normalized_url = normalize_public_url(item.source_url)

        if not normalized_url or normalized_url not in supplied_urls:
            continue

        key = (item.claim, normalized_url)

        if key in seen:
            continue

        seen.add(key)
        source = supplied_urls[normalized_url]
        evidence.append(
            CompanyEvidence(
                claim=item.claim,
                source_url=normalized_url,
                source_title=item.source_title or source.title,
            )
        )

        if normalized_url not in sources:
            sources.append(normalized_url)

    research = CompanyResearchResult(
        researched_company_name=evaluation.resolved_company_name,
        summary=" ".join(evaluation.reasons),
        facts=[item.claim for item in evidence],
        identity_ambiguous=evaluation.identity_ambiguous,
        sources_conflict=evaluation.source_conflict,
        confidence=evaluation.confidence,
        company_evidence=evidence,
        company_sources=sources,
    )
    scorecard = CompanyQualityScorecard(
        company_scale_score=evaluation.company_scale_score,
        company_market_position_score=evaluation.company_market_position_score,
        company_geographic_reach_score=evaluation.company_geographic_reach_score,
        company_engineering_maturity_score=(
            evaluation.company_engineering_maturity_score
        ),
        company_reputation_score=evaluation.company_reputation_score,
        company_quality_reasons=evaluation.reasons,
    )
    return CompanyResearchAssessment(
        research=research,
        scorecard=scorecard,
        provider="serper_groq",
    )


def research_with_serper_groq(
    job: AnalyzeMatchRequest,
) -> CompanyResearchAssessment:
    results = [(query, _search_serper(query)) for query in build_search_queries(job)]
    evidence = normalize_search_results(results)

    if not evidence:
        raise AIProviderError("Serper returned no usable company evidence")

    evaluation = _evaluate_with_groq(job, evidence)
    return _normalize_evaluation(evaluation, evidence)
