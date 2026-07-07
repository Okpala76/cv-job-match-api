def get_match_level(score: int) -> str:
    if score >= 75:
        return "Strong"
    if score >= 55:
        return "Medium"
    return "Weak"


def get_decision(score: int) -> str:
    if score >= 75:
        return "Apply"
    if score >= 55:
        return "Tailor first"
    return "Skip"


def validate_score(score: int) -> int:
    if score < 0 or score > 100:
        raise ValueError("Match percentage must be between 0 and 100")
    return score
