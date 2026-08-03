from app.schemas import AIJobScreeningResult, AnalyzeMatchRequest

LOW_VALUE_ROLE_TERMS = {
    "intern",
    "internship",
    "entry level",
    "entry-level",
    "junior",
    "graduate",
    "graduate programme",
    "graduate program",
    "trainee",
    "apprentice",
    "volunteer",
    "unpaid",
}


def find_hard_rejection_reason(
    job: AnalyzeMatchRequest,
) -> str | None:
    """
    Reject clearly low-level roles before making an AI request.

    Only structured fields are checked here to reduce false positives
    from sentences inside the full job description.
    """

    structured_job_information = " ".join(
        [
            job.job_title,
            job.job_level,
            job.job_type,
        ]
    ).lower()

    for term in LOW_VALUE_ROLE_TERMS:
        if term in structured_job_information:
            return f"Role contains a disallowed low-value classification: {term}"

    return None


def calculate_screening_decision(
    screening: AIJobScreeningResult,
) -> str:
    """
    The job must be both high-end and high-paying to be accepted.
    """

    if (
        screening.job_quality_level == "High-end"
        and screening.salary_status == "High-paying"
    ):
        return "Accepted"

    if (
        screening.job_quality_level == "Not high-end"
        or screening.salary_status == "Not high-paying"
    ):
        return "Rejected"

    return "Manual review"


def calculate_match_result(
    match_percentage: int,
) -> tuple[str, str]:
    """
    Enforce the final CV-match thresholds in Python.

    Gemini cannot override these rules.
    """

    if not 0 <= match_percentage <= 100:
        raise ValueError("Match percentage must be between 0 and 100")

    if match_percentage >= 90:
        return "Strong", "Apply"

    if match_percentage >= 70:
        return "Medium", "Tailor first"

    return "Weak", "Skip"
