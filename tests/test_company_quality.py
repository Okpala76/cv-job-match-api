import pytest

from app import company_quality
from app.schemas import (
    AnalyzeMatchRequest,
    CompanyEvidence,
    CompanyQualityScorecard,
    CompanyResearchResult,
)


def make_job(**overrides: str) -> AnalyzeMatchRequest:
    values = {
        "company_name": "Example Company",
        "job_title": "Software Engineer",
        "country_location": "Lagos, Nigeria",
        "job_type": "Full-time",
        "job_level": "",
        "salary_text": "",
        "job_link": "https://example.com/job",
        "job_description": "Requires 3 years of software experience.",
    }
    values.update(overrides)
    return AnalyzeMatchRequest(**values)


def make_research(**overrides) -> CompanyResearchResult:
    values = {
        "researched_company_name": "Example Company",
        "summary": "Established company with verifiable public operations.",
        "facts": ["The company has substantial operations."],
        "identity_ambiguous": False,
        "sources_conflict": False,
        "confidence": "High",
        "company_evidence": [
            CompanyEvidence(
                claim="The company has substantial operations.",
                source_url="https://company.example/annual-report",
                source_title="Annual report",
            ),
            CompanyEvidence(
                claim="The company is institutionally supervised.",
                source_url="https://regulator.example/company-record",
                source_title="Regulatory record",
            ),
            CompanyEvidence(
                claim="The company is a significant market participant.",
                source_url="https://business.example/company-profile",
                source_title="Company profile",
            ),
        ],
        "company_sources": [
            "https://company.example/annual-report",
            "https://regulator.example/company-record",
            "https://business.example/company-profile",
        ],
    }
    values.update(overrides)
    return CompanyResearchResult(**values)


def make_scorecard(**overrides: int) -> CompanyQualityScorecard:
    values = {
        "company_scale_score": 27,
        "company_market_position_score": 22,
        "company_geographic_reach_score": 12,
        "company_engineering_maturity_score": 15,
        "company_reputation_score": 8,
        "company_quality_reasons": ["Strong evidence across the rubric."],
    }
    values.update(overrides)
    return CompanyQualityScorecard(**values)


@pytest.fixture(autouse=True)
def clear_cache() -> None:
    company_quality.clear_company_quality_cache()


def test_strong_multi_country_company_is_accepted() -> None:
    result = company_quality.evaluate_company_research(
        make_research(),
        make_scorecard(),
    )
    assert result.company_quality_decision == "Accepted"
    assert result.company_quality_score == 84


def test_strong_national_company_is_accepted() -> None:
    result = company_quality.evaluate_company_research(
        make_research(),
        make_scorecard(
            company_scale_score=25,
            company_market_position_score=22,
            company_geographic_reach_score=5,
            company_engineering_maturity_score=15,
            company_reputation_score=8,
        ),
    )
    assert result.company_quality_score == 75
    assert result.company_quality_decision == "Accepted"


def test_small_startup_is_rejected() -> None:
    result = company_quality.evaluate_company_research(
        make_research(),
        make_scorecard(
            company_scale_score=10,
            company_market_position_score=10,
            company_geographic_reach_score=0,
            company_engineering_maturity_score=8,
            company_reputation_score=5,
        ),
    )
    assert result.company_quality_decision == "Rejected"


def test_high_total_with_weak_scale_is_rejected() -> None:
    result = company_quality.evaluate_company_research(
        make_research(),
        make_scorecard(
            company_scale_score=15,
            company_market_position_score=25,
            company_geographic_reach_score=15,
            company_engineering_maturity_score=20,
            company_reputation_score=10,
        ),
    )
    assert result.company_quality_score == 85
    assert result.company_quality_decision == "Rejected"


def test_one_credible_source_requires_manual_review() -> None:
    result = company_quality.evaluate_company_research(
        make_research(company_sources=["https://company.example/about"]),
        make_scorecard(),
    )
    assert result.company_quality_decision == "Manual review"


def test_low_credibility_source_does_not_satisfy_source_gate() -> None:
    result = company_quality.evaluate_company_research(
        make_research(
            company_evidence=[
                CompanyEvidence(
                    claim="Official company information.",
                    source_url="https://company.example/about",
                ),
                CompanyEvidence(
                    claim="Unverified commentary.",
                    source_url="https://medium.com/example-company",
                ),
            ],
            company_sources=[
                "https://company.example/about",
                "https://medium.com/example-company",
            ],
        ),
        make_scorecard(),
    )
    assert result.company_quality_decision == "Manual review"


def test_conflicting_sources_require_manual_review() -> None:
    result = company_quality.evaluate_company_research(
        make_research(sources_conflict=True),
        make_scorecard(),
    )
    assert result.company_quality_decision == "Manual review"


def test_low_confidence_requires_manual_review() -> None:
    result = company_quality.evaluate_company_research(
        make_research(confidence="Low"),
        make_scorecard(),
    )
    assert result.company_quality_decision == "Manual review"


def test_score_69_is_rejected() -> None:
    result = company_quality.evaluate_company_research(
        make_research(),
        make_scorecard(
            company_scale_score=20,
            company_market_position_score=18,
            company_geographic_reach_score=10,
            company_engineering_maturity_score=14,
            company_reputation_score=7,
        ),
    )
    assert result.company_quality_score == 69
    assert result.company_quality_decision == "Rejected"


def test_score_70_with_scale_20_and_two_sources_is_accepted() -> None:
    result = company_quality.evaluate_company_research(
        make_research(
            company_sources=[
                "https://company.example/annual-report",
                "https://regulator.example/company-record",
            ]
        ),
        make_scorecard(
            company_scale_score=20,
            company_market_position_score=18,
            company_geographic_reach_score=10,
            company_engineering_maturity_score=14,
            company_reputation_score=8,
        ),
    )
    assert result.company_quality_score == 70
    assert result.company_quality_decision == "Accepted"


def test_research_failure_returns_uncached_manual_review(monkeypatch) -> None:
    calls = 0

    def fail_research(job: AnalyzeMatchRequest) -> CompanyResearchResult:
        nonlocal calls
        calls += 1
        raise ConnectionError("Search unavailable")

    monkeypatch.setattr(company_quality, "research_company", fail_research)

    first = company_quality.assess_company_quality(make_job())
    second = company_quality.assess_company_quality(make_job())

    assert first.company_quality_decision == "Manual review"
    assert first.company_confidence == "Low"
    assert second.company_quality_decision == "Manual review"
    assert calls == 2


def test_scoring_failure_preserves_grounded_research(monkeypatch) -> None:
    research = make_research()
    monkeypatch.setattr(company_quality, "research_company", lambda job: research)

    def fail_scoring(research: CompanyResearchResult) -> CompanyQualityScorecard:
        raise RuntimeError("Scoring unavailable")

    monkeypatch.setattr(company_quality, "score_company_research", fail_scoring)

    result = company_quality.assess_company_quality(make_job())

    assert result.company_quality_decision == "Manual review"
    assert result.company_confidence == "Low"
    assert result.company_evidence == research.company_evidence
    assert result.company_sources == research.company_sources


def test_no_grounding_citations_skips_scoring(monkeypatch) -> None:
    research = make_research(company_evidence=[], company_sources=[])
    monkeypatch.setattr(company_quality, "research_company", lambda job: research)

    def fail_if_called(research: CompanyResearchResult) -> CompanyQualityScorecard:
        raise AssertionError("Ungrounded research must not be scored")

    monkeypatch.setattr(company_quality, "score_company_research", fail_if_called)

    result = company_quality.assess_company_quality(make_job())

    assert result.company_quality_decision == "Manual review"
    assert result.company_confidence == "Low"
    assert result.company_sources == []


def test_normalized_company_name_uses_process_cache(monkeypatch) -> None:
    research_calls = 0

    def fake_research(job: AnalyzeMatchRequest) -> CompanyResearchResult:
        nonlocal research_calls
        research_calls += 1
        return make_research()

    monkeypatch.setattr(company_quality, "research_company", fake_research)
    monkeypatch.setattr(
        company_quality,
        "score_company_research",
        lambda research: make_scorecard(),
    )

    first = company_quality.assess_company_quality(
        make_job(company_name="Example Company")
    )
    second = company_quality.assess_company_quality(
        make_job(company_name="  example-company  ")
    )

    assert first.company_quality_decision == "Accepted"
    assert second.company_quality_decision == "Accepted"
    assert research_calls == 1
