import pytest

from app import company_research
from app.ai_client import AIProviderError
from app.research_providers.base import CompanyResearchAssessment
from app.schemas import (
    AnalyzeMatchRequest,
    CompanyEvidence,
    CompanyQualityScorecard,
    CompanyResearchResult,
)


def make_job() -> AnalyzeMatchRequest:
    return AnalyzeMatchRequest(
        company_name="Example Company",
        job_title="Software Engineer",
        country_location="Lagos, Nigeria",
        job_link="https://example.com/job",
        job_description="Build software products.",
    )


def make_assessment(
    *,
    provider="serper_groq",
    confidence="High",
    identity_ambiguous=False,
    sources_conflict=False,
    source_count=2,
    total="strong",
) -> CompanyResearchAssessment:
    urls = [f"https://source{index}.example/company" for index in range(source_count)]
    research = CompanyResearchResult(
        researched_company_name="Example Company",
        summary="Completed public company research.",
        facts=["Public evidence was found."],
        identity_ambiguous=identity_ambiguous,
        sources_conflict=sources_conflict,
        confidence=confidence,
        company_evidence=[
            CompanyEvidence(claim=f"Claim {index}", source_url=url)
            for index, url in enumerate(urls)
        ],
        company_sources=urls,
    )
    scorecard = CompanyQualityScorecard(
        company_scale_score=27 if total == "strong" else 10,
        company_market_position_score=22 if total == "strong" else 10,
        company_geographic_reach_score=12 if total == "strong" else 5,
        company_engineering_maturity_score=15 if total == "strong" else 8,
        company_reputation_score=8 if total == "strong" else 5,
        company_quality_reasons=["Evidence-based score."],
    )
    return CompanyResearchAssessment(
        research=research,
        scorecard=scorecard,
        provider=provider,
    )


@pytest.mark.parametrize("total", ["strong", "weak"])
def test_conclusive_primary_does_not_call_gemini(monkeypatch, total) -> None:
    primary = make_assessment(total=total)
    monkeypatch.setattr(
        company_research, "research_with_serper_groq", lambda job: primary
    )

    def fail_fallback(job):
        raise AssertionError("Gemini must not run for conclusive primary research")

    monkeypatch.setattr(company_research, "research_with_gemini", fail_fallback)

    assert company_research.research_company(make_job()) is primary


@pytest.mark.parametrize(
    "primary",
    [
        make_assessment(source_count=1),
        make_assessment(confidence="Low"),
        make_assessment(identity_ambiguous=True),
        make_assessment(sources_conflict=True),
    ],
)
def test_inconclusive_primary_uses_gemini(monkeypatch, primary) -> None:
    fallback = make_assessment(provider="gemini")
    monkeypatch.setattr(
        company_research, "research_with_serper_groq", lambda job: primary
    )
    monkeypatch.setattr(
        company_research, "research_with_gemini", lambda job: fallback
    )

    assert company_research.research_company(make_job()) is fallback


@pytest.mark.parametrize("provider_error", ["Serper 429", "Groq 429"])
def test_primary_provider_quota_failure_uses_gemini(
    monkeypatch,
    provider_error,
) -> None:
    fallback = make_assessment(provider="gemini")

    def fail_primary(job):
        raise AIProviderError(provider_error)

    monkeypatch.setattr(company_research, "research_with_serper_groq", fail_primary)
    monkeypatch.setattr(
        company_research, "research_with_gemini", lambda job: fallback
    )

    assert company_research.research_company(make_job()) is fallback


def test_both_provider_paths_unavailable(monkeypatch) -> None:
    def fail_primary(job):
        raise AIProviderError("Serper 429")

    def fail_fallback(job):
        raise AIProviderError("Gemini 429")

    monkeypatch.setattr(company_research, "research_with_serper_groq", fail_primary)
    monkeypatch.setattr(company_research, "research_with_gemini", fail_fallback)

    with pytest.raises(AIProviderError, match="providers are unavailable"):
        company_research.research_company(make_job())


def test_inconclusive_primary_survives_technical_fallback_failure(monkeypatch) -> None:
    primary = make_assessment(source_count=1)
    monkeypatch.setattr(
        company_research, "research_with_serper_groq", lambda job: primary
    )

    def fail_fallback(job):
        raise AIProviderError("Gemini 429")

    monkeypatch.setattr(company_research, "research_with_gemini", fail_fallback)

    result = company_research.research_company(make_job())

    assert result.research == primary.research
    assert result.cacheable is False


def test_unexpected_primary_error_is_not_misclassified_as_provider_failure(
    monkeypatch,
) -> None:
    def fail_primary(job):
        raise RuntimeError("internal normalization bug")

    def fail_if_called(job):
        raise AssertionError("Fallback must not hide internal programming errors")

    monkeypatch.setattr(company_research, "research_with_serper_groq", fail_primary)
    monkeypatch.setattr(company_research, "research_with_gemini", fail_if_called)

    with pytest.raises(RuntimeError, match="internal normalization bug"):
        company_research.research_company(make_job())
