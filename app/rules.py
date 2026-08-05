def calculate_match_result(
    match_percentage: int,
) -> tuple[str, str]:
    """Enforce the final CV-match thresholds in Python."""

    if not 0 <= match_percentage <= 100:
        raise ValueError("Match percentage must be between 0 and 100")

    if match_percentage >= 90:
        return "Strong", "Apply"

    if match_percentage >= 70:
        return "Medium", "Tailor first"

    return "Weak", "Skip"
