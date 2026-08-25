from app.rules import calculate_match_result


def test_cv_match_thresholds_remain_python_enforced() -> None:
    assert calculate_match_result(100) == ("Strong", "Apply")
    assert calculate_match_result(90) == ("Strong", "Apply")
    assert calculate_match_result(89) == ("Medium", "Tailor first")
    assert calculate_match_result(70) == ("Medium", "Tailor first")
    assert calculate_match_result(69) == ("Weak", "Skip")
    assert calculate_match_result(0) == ("Weak", "Skip")
