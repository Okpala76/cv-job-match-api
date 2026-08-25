from __future__ import annotations

import re

from app.schemas import (
    AnalyzeMatchRequest,
    RoleCeilingResult,
)

_ROLE_FLOOR_TERMS = (
    "intern",
    "internship",
    "graduate trainee",
    "management trainee",
    "trainee",
    "apprentice",
    "apprenticeship",
    "nysc",
    "volunteer",
)


_LEADERSHIP_TITLE_TERMS = (
    "manager",
    "director",
    "head of",
    "vice president",
    "vp",
    "staff engineer",
    "staff software engineer",
    "principal engineer",
    "principal software engineer",
    "software architect",
    "solutions architect",
    "solution architect",
    "enterprise architect",
    "technical architect",
    "engineering manager",
    "software engineering manager",
    "development manager",
    "head of engineering",
    "head of technology",
    "technical lead",
    "tech lead",
    "engineering lead",
    "lead engineer",
    "lead developer",
    "team lead",
    "director of engineering",
    "engineering director",
    "vice president of engineering",
    "vp engineering",
    "chief technology officer",
    "cto",
)


_MANAGERIAL_TITLE_TERMS = (
    "manager",
    "director",
    "head of",
    "vice president",
    "vp",
    "engineering manager",
    "software engineering manager",
    "development manager",
    "head of engineering",
    "head of technology",
    "director of engineering",
    "engineering director",
    "vice president of engineering",
    "vp engineering",
    "chief technology officer",
    "cto",
)


_SENIOR_TERMS = (
    "senior",
    "sr",
)


_INTERNSHIP_TERMS = (
    "intern",
    "internship",
)


_GRADUATE_TERMS = (
    "graduate",
    "trainee",
)


_ENTRY_LEVEL_TERMS = (
    "entry level",
    "entry-level",
)


_JUNIOR_TERMS = (
    "junior",
    "associate",
)


_MID_LEVEL_TERMS = (
    "mid level",
    "mid-level",
    "intermediate",
)


_EXPERIENCE_RANGE_PATTERN = re.compile(
    r"\b(?P<minimum>\d{1,2})\s*"
    r"(?:-|–|—|to)\s*"
    r"(?P<maximum>\d{1,2})\s*"
    r"(?:years?|yrs?)\b",
    re.IGNORECASE,
)


_EXPERIENCE_SINGLE_PATTERN = re.compile(
    r"\b"
    r"(?P<prefix>"
    r"minimum(?:\s+of)?|"
    r"at\s+least|"
    r"over|"
    r"more\s+than"
    r")?\s*"
    r"(?P<years>\d{1,2})\s*"
    r"(?P<plus>\+)?\s*"
    r"(?:years?|yrs?)\b"
    r"(?=[^.\n]{0,80}\b(?:experience|required)\b)",
    re.IGNORECASE,
)


def _normalize_text(value: str) -> str:
    normalized = str(value or "").lower().replace("&", " and ")

    normalized = re.sub(
        r"[^a-z0-9+]+",
        " ",
        normalized,
    )

    return " ".join(normalized.split())


def _contains_term(
    text: str,
    terms: tuple[str, ...],
) -> bool:
    padded_text = f" {text} "

    return any(f" {_normalize_text(term)} " in padded_text for term in terms)


def _extract_experience_requirement(
    job_description: str,
) -> tuple[int | None, int | None]:
    text = str(job_description or "")

    minimums: list[int] = []
    maximums: list[int] = []
    range_spans: list[tuple[int, int]] = []

    for match in _EXPERIENCE_RANGE_PATTERN.finditer(text):
        minimum = int(match.group("minimum"))
        maximum = int(match.group("maximum"))

        if minimum > maximum:
            minimum, maximum = maximum, minimum

        minimums.append(minimum)
        maximums.append(maximum)
        range_spans.append(match.span())

    def is_inside_range(
        span: tuple[int, int],
    ) -> bool:
        start, end = span

        return any(
            start >= range_start and end <= range_end
            for range_start, range_end in range_spans
        )

    for match in _EXPERIENCE_SINGLE_PATTERN.finditer(text):
        if is_inside_range(match.span()):
            continue

        years = int(match.group("years"))

        prefix = (match.group("prefix") or "").lower()

        if prefix in {
            "over",
            "more than",
        }:
            years += 1

        minimums.append(years)

    minimum_required = max(minimums) if minimums else None

    maximum_required = max(maximums) if maximums else None

    return (
        minimum_required,
        maximum_required,
    )


def _detect_role_level(
    title_and_level: str,
) -> str:
    if _contains_term(
        title_and_level,
        _LEADERSHIP_TITLE_TERMS,
    ):
        return "Leadership"

    if _contains_term(
        title_and_level,
        _SENIOR_TERMS,
    ):
        return "Senior"

    if _contains_term(
        title_and_level,
        _INTERNSHIP_TERMS,
    ):
        return "Internship"

    if _contains_term(
        title_and_level,
        _GRADUATE_TERMS,
    ):
        return "Graduate"

    if _contains_term(
        title_and_level,
        _ENTRY_LEVEL_TERMS,
    ):
        return "Entry-level"

    if _contains_term(
        title_and_level,
        _JUNIOR_TERMS,
    ):
        return "Junior"

    if _contains_term(
        title_and_level,
        _MID_LEVEL_TERMS,
    ):
        return "Mid-level"

    return "Unspecified"


def evaluate_role_ceiling(
    job: AnalyzeMatchRequest,
) -> RoleCeilingResult:
    """Apply the role floor and five-year minimum-experience ceiling."""

    title_and_level = _normalize_text(
        f"{job.job_title} {job.job_level} {job.job_type}"
    )

    full_job_text = _normalize_text(
        f"{job.job_title} {job.job_level} {job.job_description}"
    )

    (
        minimum_years,
        maximum_years,
    ) = _extract_experience_requirement(job.job_description)

    detected_level = _detect_role_level(title_and_level)

    if _contains_term(title_and_level, _ROLE_FLOOR_TERMS) or _contains_term(
        full_job_text,
        ("unpaid",),
    ):
        return RoleCeilingResult(
            role_ceiling_decision="Rejected",
            detected_role_level=detected_level,
            role_ceiling_reasons=[
                "The role is an internship, trainee, apprenticeship, NYSC, volunteer, or unpaid opportunity below the role floor."
            ],
            minimum_required_experience_years=minimum_years,
            maximum_required_experience_years=maximum_years,
        )

    if not job.job_title.strip():
        return RoleCeilingResult(
            role_ceiling_decision="Manual review",
            detected_role_level="Unspecified",
            role_ceiling_reasons=[
                "Job title was not provided, so the role level cannot be confirmed."
            ],
            minimum_required_experience_years=(minimum_years),
            maximum_required_experience_years=(maximum_years),
        )

    if minimum_years is not None and minimum_years >= 6:
        return RoleCeilingResult(
            role_ceiling_decision="Rejected",
            detected_role_level=detected_level,
            role_ceiling_reasons=[
                (
                    f"The role requires at least "
                    f"{minimum_years} years of experience, "
                    "which is above the 5-year ceiling."
                )
            ],
            minimum_required_experience_years=(minimum_years),
            maximum_required_experience_years=(maximum_years),
        )

    if minimum_years is None and _contains_term(
        title_and_level,
        _MANAGERIAL_TITLE_TERMS,
    ):
        return RoleCeilingResult(
            role_ceiling_decision="Manual review",
            detected_role_level=detected_level,
            role_ceiling_reasons=[
                "The title is managerial or executive-level, but no reliable minimum experience requirement was found."
            ],
            minimum_required_experience_years=(minimum_years),
            maximum_required_experience_years=(maximum_years),
        )

    if minimum_years is None:
        reasons = [
            "No reliable minimum experience requirement above the 5-year ceiling was found."
        ]
    else:
        reasons = [
            f"Role requires {minimum_years} years of experience, which is within the 5-year ceiling."
        ]

    return RoleCeilingResult(
        role_ceiling_decision="Accepted",
        detected_role_level=detected_level,
        role_ceiling_reasons=reasons,
        minimum_required_experience_years=(minimum_years),
        maximum_required_experience_years=(maximum_years),
    )
