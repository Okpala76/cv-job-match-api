import pytest
from fastapi.testclient import TestClient

from app import company_quality, main
from app.schemas import AIAnalysisResult, CompanyQualityResult

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


def test_search_failure_does_not_run_cv_matching(monkeypatch) -> None:
    company_quality.clear_company_quality_cache()

    def fail_research(job):
        raise ConnectionError("Search unavailable")

    def fail_if_called(job_description: str) -> AIAnalysisResult:
        raise AssertionError("CV matching should not run")

    monkeypatch.setattr(company_quality, "research_company", fail_research)
    monkeypatch.setattr(main, "assess_company_quality", company_quality.assess_company_quality)
    monkeypatch.setattr(main, "analyze_cv_match", fail_if_called)

    response = client.post(
        "/analyze-match",
        headers={"x-api-key": "test-api-key"},
        json=make_payload(company_name="Search Failure Company"),
    )

    assert response.status_code == 200
    result = response.json()
    assert result["company_quality_decision"] == "Manual review"
    assert result["company_confidence"] == "Low"
    assert result["job_accepted"] is False
    assert result["decision"] == "Skip"
    assert result["match_percentage"] is None
