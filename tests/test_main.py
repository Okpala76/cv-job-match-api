import pytest
from fastapi.testclient import TestClient

from app import main
from app.schemas import AIAnalysisResult

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def configure_api_key(monkeypatch) -> None:
    monkeypatch.setattr(main, "APP_API_KEY", "test-api-key")


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
    assert result["company_status"] == "Unknown"
    assert result["salary_status"] == "Unknown"
    assert result["match_level"] == "Medium"
    assert result["decision"] == "Tailor first"
