from app.salary import assess_salary


def test_monthly_salary_meets_threshold() -> None:
    result = assess_salary("₦500,000 per month")
    assert result.status == "High-paying"
    assert result.monthly_ngn == 500_000


def test_annual_salary_is_converted_to_monthly() -> None:
    result = assess_salary("NGN 6,000,000 per annum")
    assert result.status == "High-paying"
    assert result.monthly_ngn == 500_000


def test_range_uses_lower_bound_conservatively() -> None:
    result = assess_salary("₦400k - ₦600k monthly")
    assert result.status == "Not high-paying"
    assert result.monthly_ngn == 400_000


def test_upper_limit_only_requires_manual_review() -> None:
    result = assess_salary("Up to ₦600k per month")
    assert result.status == "Unknown"
    assert result.monthly_ngn is None


def test_missing_salary_is_unknown() -> None:
    result = assess_salary("")
    assert result.status == "Unknown"
