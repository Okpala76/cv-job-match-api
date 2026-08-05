from __future__ import annotations

from app.company_registry import APPROVED_COMPANY_REGISTRY
from app.salary import NGN_MONTHLY_THRESHOLD, assess_salary
from app.schemas import AnalyzeMatchRequest, OpportunityGateResult


def evaluate_opportunity_gate(job: AnalyzeMatchRequest) -> OpportunityGateResult:
    """Apply the deterministic approved-company OR salary gate."""

    company_match = APPROVED_COMPANY_REGISTRY.match(job.company_name)
    salary = assess_salary(job.salary_text)

    if company_match:
        record = company_match.record
        reasons = [
            f"Approved Tier {record.company_tier} company: {record.canonical_name}."
        ]

        if salary.status != "Unknown":
            reasons.append(salary.reason)
        elif job.salary_text.strip():
            reasons.append(salary.reason)
        else:
            reasons.append(
                "Salary disclosure is not required because the company is approved."
            )

        return OpportunityGateResult(
            job_accepted=True,
            screening_decision="Accepted",
            screening_reasons=reasons,
            salary_status=salary.status,
            job_quality_level="High-end",
            company_status="Approved",
            matched_company_name=record.canonical_name,
            company_tier=record.company_tier,
            monthly_salary_ngn=salary.monthly_ngn,
        )

    company_status = "Unknown" if not job.company_name.strip() else "Not approved"
    company_reason = (
        "Company name was not provided."
        if company_status == "Unknown"
        else "Company is not on the approved Nigerian high-tier registry."
    )

    if salary.status == "High-paying":
        return OpportunityGateResult(
            job_accepted=True,
            screening_decision="Accepted",
            screening_reasons=[company_reason, salary.reason],
            salary_status=salary.status,
            job_quality_level="High-end",
            company_status=company_status,
            matched_company_name=None,
            company_tier=None,
            monthly_salary_ngn=salary.monthly_ngn,
        )

    if salary.status == "Not high-paying":
        return OpportunityGateResult(
            job_accepted=False,
            screening_decision="Rejected",
            screening_reasons=[company_reason, salary.reason],
            salary_status=salary.status,
            job_quality_level="Not high-end",
            company_status=company_status,
            matched_company_name=None,
            company_tier=None,
            monthly_salary_ngn=salary.monthly_ngn,
        )

    return OpportunityGateResult(
        job_accepted=False,
        screening_decision="Manual review",
        screening_reasons=[
            company_reason,
            salary.reason,
            (
                "Confirm that the company should be added to the registry or that "
                f"monthly compensation is at least ₦{NGN_MONTHLY_THRESHOLD:,}."
            ),
        ],
        salary_status="Unknown",
        job_quality_level="Unknown",
        company_status=company_status,
        matched_company_name=None,
        company_tier=None,
        monthly_salary_ngn=None,
    )
