import logging

import pytest
from fastapi.testclient import TestClient

from app import company_quality, main
from app.schemas import (
    AIAnalysisResult,
    CompanyEvidence,
    CompanyQualityResult,
    CompanyQualityScorecard,
    CompanyResearchResult,
)

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def configure_api_key(monkeypatch) -> None:
    monkeypatch.setattr(main, "APP_API_KEY", "test-api-key")
    monkeypatch.setattr(
        main,
        "assess_company_quality",
        lambda job: make_company_result("Accepted"),
    )


def make_company_result(decision: str) -> CompanyQualityResult:
    accepted = decision == "Accepted"
    return CompanyQualityResult(
        company_quality_decision=decision,
        company_quality_score=84 if accepted else 40,
        company_scale_score=27 if accepted else 10,
        company_market_position_score=22 if accepted else 10,
        company_geographic_reach_score=12 if accepted else 5,
        company_engineering_maturity_score=15 if accepted else 10,
        company_reputation_score=8 if accepted else 5,
        company_quality_reasons=["Mocked company quality result."],
        company_evidence=[
            {
                "claim": "The company has substantial operations.",
                "source_url": "https://company.example/about",
                "source_title": "Company profile",
            },
            {
                "claim": "The company is institutionally supervised.",
                "source_url": "https://regulator.example/record",
                "source_title": "Regulatory record",
            },
        ],
        company_sources=[
            "https://company.example/about",
            "https://regulator.example/record",
        ],
        company_confidence="High" if accepted else "Low",
    )


def make_payload(**overrides: str) -> dict[str, str]:
    values = {
        "company_name": "Any Company",
        "job_title": "Software Engineer",
        "country_location": "Lagos, Nigeria",
        "job_type": "Full-time",
        "job_level": "",
        "salary_text": "₦100,000 monthly",
        "job_link": "https://example.com/job",
        "job_description": "Requires 3 years of software experience.",
    }
    values.update(overrides)
    return values


def make_research(**overrides) -> CompanyResearchResult:
    values = {
        "researched_company_name": "Any Company",
        "summary": "Established company with public evidence.",
        "facts": ["The company has substantial operations."],
        "identity_ambiguous": False,
        "sources_conflict": False,
        "confidence": "High",
        "company_evidence": [
            CompanyEvidence(
                claim="The company has substantial operations.",
                source_url="https://company.example/about",
            ),
            CompanyEvidence(
                claim="The company is institutionally supervised.",
                source_url="https://regulator.example/record",
            ),
        ],
        "company_sources": [
            "https://company.example/about",
            "https://regulator.example/record",
        ],
    }
    values.update(overrides)
    return CompanyResearchResult(**values)


def make_scorecard() -> CompanyQualityScorecard:
    return CompanyQualityScorecard(
        company_scale_score=27,
        company_market_position_score=22,
        company_geographic_reach_score=12,
        company_engineering_maturity_score=15,
        company_reputation_score=8,
        company_quality_reasons=["Strong evidence across the rubric."],
    )


def use_company_quality_pipeline(monkeypatch) -> None:
    company_quality.clear_company_quality_cache()
    monkeypatch.setattr(
        main,
        "assess_company_quality",
        company_quality.assess_company_quality,
    )


def test_api_key_authentication_is_still_required() -> None:
    response = client.post("/analyze-match", json=make_payload())
    assert response.status_code == 401


def test_failed_geography_does_not_run_cv_matching(monkeypatch) -> None:
    def fail_if_called(job_description: str) -> AIAnalysisResult:
        raise AssertionError("CV matching should not run")

    monkeypatch.setattr(main, "analyze_cv_match", fail_if_called)
    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(country_location="London only"),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["geography_decision"] == "Rejected"
    assert result["job_accepted"] is False
    assert result["decision"] == "Skip"
    assert result["match_percentage"] is None


def test_failed_role_floor_does_not_run_cv_matching(monkeypatch) -> None:
    def fail_if_called(job_description: str) -> AIAnalysisResult:
        raise AssertionError("CV matching should not run")

    monkeypatch.setattr(main, "analyze_cv_match", fail_if_called)
    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(job_title="Software Engineering Intern"),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["role_ceiling_decision"] == "Rejected"
    assert result["job_accepted"] is False
    assert result["decision"] == "Skip"
    assert result["match_percentage"] is None


def test_eligible_job_reaches_cv_matching_and_python_thresholds(monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "analyze_cv_match",
        lambda job_description: AIAnalysisResult(
            match_percentage=89,
            matched_skills=["Python"],
            missing_skills=[],
            tailoring_advice="Emphasize Python delivery experience.",
        ),
    )
    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["job_accepted"] is True
    for legacy_field in (
        "company_status",
        "matched_company_name",
        "company_tier",
        "salary_status",
        "job_quality_level",
    ):
        assert legacy_field not in result
    assert result["company_quality_decision"] == "Accepted"
    assert result["match_level"] == "Medium"
    assert result["decision"] == "Tailor first"


@pytest.mark.parametrize("company_decision", ["Rejected", "Manual review"])
def test_company_failure_does_not_run_cv_matching(
    monkeypatch,
    company_decision: str,
) -> None:
    def fail_if_called(job_description: str) -> AIAnalysisResult:
        raise AssertionError("CV matching should not run")

    monkeypatch.setattr(main, "analyze_cv_match", fail_if_called)
    monkeypatch.setattr(
        main,
        "assess_company_quality",
        lambda job: make_company_result(company_decision),
    )
    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["company_quality_decision"] == company_decision
    assert result["job_accepted"] is False
    assert result["decision"] == "Skip"
    assert result["match_percentage"] is None
    assert result["match_level"] is None


def test_insufficient_grounded_evidence_returns_manual_review(monkeypatch) -> None:
    research = make_research(
        company_evidence=[
            CompanyEvidence(
                claim="The company has public operations.",
                source_url="https://company.example/about",
            )
        ],
        company_sources=["https://company.example/about"],
    )
    use_company_quality_pipeline(monkeypatch)
    monkeypatch.setattr(company_quality, "research_company", lambda job: research)
    monkeypatch.setattr(
        company_quality, "score_company_research", lambda research: make_scorecard()
    )

    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(company_name="Sparse Evidence Company"),
    )

    assert response.status_code == 200
    assert response.json()["company_quality_decision"] == "Manual review"


def test_ambiguous_company_returns_manual_review(monkeypatch) -> None:
    use_company_quality_pipeline(monkeypatch)
    monkeypatch.setattr(
        company_quality,
        "research_company",
        lambda job: make_research(identity_ambiguous=True),
    )
    monkeypatch.setattr(
        company_quality, "score_company_research", lambda research: make_scorecard()
    )

    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(company_name="Ambiguous Company"),
    )

    assert response.status_code == 200
    assert response.json()["company_quality_decision"] == "Manual review"


def test_research_runtime_error_is_logged_and_returns_500(
    monkeypatch,
    caplog,
) -> None:
    use_company_quality_pipeline(monkeypatch)

    def fail_research(job):
        raise RuntimeError("Gemini research returned malformed JSON")

    def fail_if_called(job_description: str) -> AIAnalysisResult:
        raise AssertionError("CV matching should not run")

    monkeypatch.setattr(company_quality, "research_company", fail_research)
    monkeypatch.setattr(main, "analyze_cv_match", fail_if_called)

    with caplog.at_level(logging.ERROR, logger="app.company_quality"):
        response = client.post(
            "/analyze-match",
            headers={"x-api-key": "test-api-key"},
            json=make_payload(company_name="Runtime Failure Company"),
        )

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Company quality analysis failed. Please retry."
    }
    assert "Runtime Failure Company" in caplog.text
    assert "RuntimeError" in caplog.text
    assert "Gemini research returned malformed JSON" in caplog.text
    assert any(record.exc_info is not None for record in caplog.records)


def test_network_provider_failure_returns_503_and_skips_cv_matching(
    monkeypatch,
) -> None:
    use_company_quality_pipeline(monkeypatch)

    def fail_research(job):
        raise ConnectionError("Search unavailable with secret-provider-detail")

    def fail_if_called(job_description: str) -> AIAnalysisResult:
        raise AssertionError("CV matching should not run")

    monkeypatch.setattr(company_quality, "research_company", fail_research)
    monkeypatch.setattr(main, "analyze_cv_match", fail_if_called)

    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(company_name="Search Failure Company"),
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Company research is temporarily unavailable. Please retry."
    }
    assert "secret-provider-detail" not in response.text


def test_successful_company_research_returns_200(monkeypatch) -> None:
    use_company_quality_pipeline(monkeypatch)
    monkeypatch.setattr(
        company_quality, "research_company", lambda job: make_research()
    )
    monkeypatch.setattr(
        company_quality, "score_company_research", lambda research: make_scorecard()
    )
    monkeypatch.setattr(
        main,
        "analyze_cv_match",
        lambda job_description: AIAnalysisResult(
            match_percentage=90,
            matched_skills=["Python"],
            missing_skills=[],
            tailoring_advice="Apply.",
        ),
    )

    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(company_name="Successful Research Company"),
    )

    assert response.status_code == 200
    assert response.json()["company_quality_decision"] == "Accepted"
