from __future__ import annotations

import os
import time
from dataclasses import dataclass, replace
from typing import Annotated, Literal
from urllib.parse import urlparse

import requests
from groq import Groq
from pydantic import BaseModel, ConfigDict, Field, ValidationError

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
_MAX_EVIDENCE_RESULTS = 8
_MAX_SNIPPET_LENGTH = 280
_MAX_TITLE_LENGTH = 160
_MAX_COMPLETION_TOKENS = 1800
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
    source_id: str = ""


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
    reasons: list[
        Annotated[str, Field(min_length=1, max_length=180)]
    ] = Field(min_length=1, max_length=5)
    source_ids: list[
        Annotated[str, Field(pattern=r"^S[1-8]$")]
    ] = Field(max_length=6)


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
    return [
        replace(item, source_id=f"S{index}")
        for index, item in enumerate(selected[:_MAX_EVIDENCE_RESULTS], start=1)
    ]


def _compact_field(value: str, max_length: int) -> str:
    return " ".join(value.replace("|", " ").split())[:max_length]


def _evaluation_prompt(job: AnalyzeMatchRequest, evidence: list[SearchEvidence]) -> str:
    evidence_lines = "\n".join(
        f"{item.source_id} | {_compact_field(item.title, _MAX_TITLE_LENGTH)} | "
        f"{item.source} | {_compact_field(item.snippet, _MAX_SNIPPET_LENGTH)}"
        for item in evidence
    )
    return f"""
Evaluate the company using ONLY the supplied Serper search evidence. Extract
facts and score the five rubric components, but do not make the final
Accepted/Rejected decision.

Rules:
- Never use unstated internal knowledge.
- Never invent financial figures, employee counts, claims, or source IDs.
- Return only source IDs supplied below. Do not return or generate URLs.
- Treat missing evidence as missing and score conservatively.
- Distinguish similarly named companies.
- Job context is only for company identity disambiguation.
- Do not judge the candidate.
- Report identity ambiguity, material source conflict, and confidence.
- Return at most 5 short reasons and at most 6 source IDs.

Return only one JSON object with exactly these fields and no additional fields:
- resolved_company_name: string
- identity_ambiguous: boolean
- source_conflict: boolean
- company_scale_score: integer 0-30
- company_market_position_score: integer 0-25
- company_geographic_reach_score: integer 0-15
- company_engineering_maturity_score: integer 0-20
- company_reputation_score: integer 0-10
- confidence: "High", "Medium", or "Low"
- reasons: array of 1-5 concise strings
- source_ids: array of at most 6 supplied IDs

Company: {job.company_name}
Job title: {job.job_title}
Location: {job.country_location}

Rubric:
{COMPANY_SCORE_RUBRIC}

Supplied evidence:
{evidence_lines}
"""


def _json_format_failure(error: Exception) -> bool:
    if isinstance(error, (ValueError, ValidationError)):
        return True

    details = f"{error} {getattr(error, 'body', '')}".lower()
    return any(
        marker in details
        for marker in (
            "json_validate_failed",
            "failed_generation",
            "max completion tokens",
            "valid json",
        )
    )


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
    use_json_object = False

    for attempt in range(_MAX_ATTEMPTS):
        try:
            response_format = (
                {"type": "json_object"}
                if use_json_object
                else {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "company_research_evaluation",
                        "strict": GROQ_MODEL in _STRICT_GROQ_MODELS,
                        "schema": GroqCompanyEvaluation.model_json_schema(),
                    },
                }
            )
            response = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Return only JSON matching the compact company "
                            "evaluation contract in the user prompt."
                        ),
                    },
                    {"role": "user", "content": _evaluation_prompt(job, evidence)},
                ],
                response_format=response_format,
                temperature=0,
                max_completion_tokens=_MAX_COMPLETION_TOKENS,
            )
            content = response.choices[0].message.content

            if not content:
                raise ValueError("Groq returned no structured company evaluation")

            return GroqCompanyEvaluation.model_validate_json(content)
        except Exception as error:  # noqa: BLE001
            last_error = error
            status_code = getattr(error, "status_code", None)
            format_failure = _json_format_failure(error)

            if attempt == 0 and format_failure:
                use_json_object = True
                continue

            if status_code is not None and not _transient_status(status_code):
                break

        if attempt + 1 < _MAX_ATTEMPTS:
            time.sleep(0.25 * (2**attempt))

    raise AIProviderError(f"Groq evaluation failed: {last_error}") from last_error


def _normalize_evaluation(
    evaluation: GroqCompanyEvaluation,
    supplied_evidence: list[SearchEvidence],
) -> CompanyResearchAssessment:
    supplied_sources = {
        item.source_id or f"S{index}": item
        for index, item in enumerate(supplied_evidence, start=1)
    }
    evidence: list[CompanyEvidence] = []
    sources: list[str] = []
    seen_source_ids: set[str] = set()

    for source_id in evaluation.source_ids:
        if source_id in seen_source_ids or source_id not in supplied_sources:
            continue

        seen_source_ids.add(source_id)
        source = supplied_sources[source_id]
        evidence.append(
            CompanyEvidence(
                claim=f"Source used in company evaluation: {source.title}",
                source_url=source.url,
                source_title=source.title,
            )
        )
        sources.append(source.url)

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
