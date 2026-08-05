from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

SalaryStatus = Literal["High-paying", "Not high-paying", "Unknown"]

NGN_MONTHLY_THRESHOLD = 500_000

_AMOUNT_PATTERN = re.compile(
    r"(?<![a-z0-9])"
    r"(?:ngn|₦|naira)?\s*"
    r"(?P<number>\d+(?:\.\d+)?)\s*"
    r"(?P<scale>k|thousand|m|million)?\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class SalaryAssessment:
    status: SalaryStatus
    monthly_ngn: int | None
    reason: str


def _scaled_amount(number: str, scale: str | None) -> Decimal:
    try:
        value = Decimal(number)
    except InvalidOperation as error:
        raise ValueError(f"Invalid salary amount: {number}") from error

    normalized_scale = (scale or "").lower()

    if normalized_scale in {"k", "thousand"}:
        value *= Decimal(1_000)
    elif normalized_scale in {"m", "million"}:
        value *= Decimal(1_000_000)

    return value


def _detect_period(text: str) -> Literal["monthly", "annual", "weekly", "daily"]:
    if re.search(r"\b(per\s+)?(year|yearly|annual|annually|annum|pa)\b", text):
        return "annual"
    if re.search(r"\b(per\s+)?(week|weekly)\b", text):
        return "weekly"
    if re.search(r"\b(per\s+)?(day|daily)\b", text):
        return "daily"
    return "monthly"


def _to_monthly(amount: Decimal, period: str) -> Decimal:
    if period == "annual":
        return amount / Decimal(12)
    if period == "weekly":
        return amount * Decimal(52) / Decimal(12)
    if period == "daily":
        return amount * Decimal(22)
    return amount


def assess_salary(
    salary_text: str,
    threshold_ngn: int = NGN_MONTHLY_THRESHOLD,
) -> SalaryAssessment:
    """Conservatively assess a disclosed Nigerian salary.

    For ranges, the lower bound is used because it is the guaranteed amount.
    An "up to" figure is not treated as a guaranteed minimum.
    Foreign-currency figures are left for manual review in this version.
    """

    original = str(salary_text or "").strip()
    if not original:
        return SalaryAssessment(
            status="Unknown",
            monthly_ngn=None,
            reason="Salary was not disclosed.",
        )

    text = original.lower().replace(",", "")

    if re.search(r"(?:\$|\busd\b|\bgbp\b|£|\beur\b|€)", text):
        return SalaryAssessment(
            status="Unknown",
            monthly_ngn=None,
            reason="Foreign-currency salary requires manual review.",
        )

    if re.search(r"\bup\s+to\b", text) and not re.search(r"[-–—]\s*", text):
        return SalaryAssessment(
            status="Unknown",
            monthly_ngn=None,
            reason="Only an upper salary limit was disclosed.",
        )

    matches = list(_AMOUNT_PATTERN.finditer(text))
    amounts: list[Decimal] = []

    for match in matches:
        number = match.group("number")
        scale = match.group("scale")
        amount = _scaled_amount(number, scale)

        # Avoid interpreting small incidental values as Nigerian salary figures.
        if amount >= Decimal(10_000):
            amounts.append(amount)

    if not amounts:
        return SalaryAssessment(
            status="Unknown",
            monthly_ngn=None,
            reason="Salary could not be parsed as a Nigerian naira amount.",
        )

    period = _detect_period(text)
    guaranteed_amount = min(amounts)
    monthly_amount = int(_to_monthly(guaranteed_amount, period))

    if monthly_amount >= threshold_ngn:
        return SalaryAssessment(
            status="High-paying",
            monthly_ngn=monthly_amount,
            reason=(
                f"Disclosed salary is approximately ₦{monthly_amount:,} per month "
                f"and meets the ₦{threshold_ngn:,} threshold."
            ),
        )

    return SalaryAssessment(
        status="Not high-paying",
        monthly_ngn=monthly_amount,
        reason=(
            f"Disclosed salary is approximately ₦{monthly_amount:,} per month "
            f"and is below the ₦{threshold_ngn:,} threshold."
        ),
    )
