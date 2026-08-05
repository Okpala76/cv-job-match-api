from app.opportunity_gate import evaluate_opportunity_gate
from app.schemas import AnalyzeMatchRequest


def make_job(**overrides: str) -> AnalyzeMatchRequest:
    values = {
        "company_name": "",
        "job_title": "Software Engineer",
        "country_location": "Lagos, Nigeria",
        "job_type": "Full-time",
        "job_level": "Mid-level",
        "salary_text": "",
        "job_link": "https://example.com/job",
        "job_description": "Build and maintain software products.",
    }
    values.update(overrides)
    return AnalyzeMatchRequest(**values)


def test_approved_company_passes_without_salary() -> None:
    result = evaluate_opportunity_gate(make_job(company_name="GTBank"))
    assert result.screening_decision == "Accepted"
    assert result.company_status == "Approved"
    assert result.company_tier == "A"


def test_approved_company_passes_even_below_salary_threshold() -> None:
    result = evaluate_opportunity_gate(
        make_job(company_name="Access Bank", salary_text="₦300,000 monthly")
    )
    assert result.screening_decision == "Accepted"
    assert result.salary_status == "Not high-paying"


def test_unknown_company_passes_with_threshold_salary() -> None:
    result = evaluate_opportunity_gate(
        make_job(company_name="Unknown Company", salary_text="₦500,000 monthly")
    )
    assert result.screening_decision == "Accepted"
    assert result.company_status == "Not approved"


def test_unknown_company_is_rejected_below_threshold() -> None:
    result = evaluate_opportunity_gate(
        make_job(company_name="Unknown Company", salary_text="₦450,000 monthly")
    )
    assert result.screening_decision == "Rejected"


def test_unknown_company_without_salary_requires_manual_review() -> None:
    result = evaluate_opportunity_gate(make_job(company_name="Unknown Company"))
    assert result.screening_decision == "Manual review"
