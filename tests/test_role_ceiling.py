from unittest import TestCase

from app.role_ceiling import evaluate_role_ceiling
from app.schemas import AnalyzeMatchRequest


def make_job(**overrides: str) -> AnalyzeMatchRequest:
    values = {
        "company_name": "Example Company",
        "job_title": "Software Engineer",
        "country_location": "Lagos, Nigeria",
        "job_type": "Full-time",
        "job_level": "",
        "salary_text": "",
        "job_link": "https://example.com/job",
        "job_description": "Build and maintain software products.",
    }
    values.update(overrides)
    return AnalyzeMatchRequest(**values)


class TestRoleCeiling(TestCase):
    def test_roles_below_the_floor_are_rejected(self) -> None:
        for title in (
            "Software Engineering Intern",
            "Graduate Trainee",
            "Management Trainee",
            "NYSC Developer",
            "Volunteer Developer",
        ):
            with self.subTest(title=title):
                result = evaluate_role_ceiling(make_job(job_title=title))
                self.assertEqual(result.role_ceiling_decision, "Rejected")

    def test_real_graduate_engineering_role_is_not_treated_as_trainee(
        self,
    ) -> None:
        for title in (
            "Graduate Software Engineer",
            "Graduate Developer",
            "Graduate Engineer",
        ):
            with self.subTest(title=title):
                result = evaluate_role_ceiling(make_job(job_title=title))
                self.assertEqual(result.role_ceiling_decision, "Accepted")
                self.assertEqual(result.detected_role_level, "Graduate")

    def test_unpaid_role_is_rejected(self) -> None:
        result = evaluate_role_ceiling(make_job(job_title="Unpaid role"))
        self.assertEqual(result.role_ceiling_decision, "Rejected")

    def test_junior_role_is_accepted(self) -> None:
        result = evaluate_role_ceiling(
            make_job(
                job_title="Junior Software Engineer",
                job_description="Requires 1 year of relevant experience.",
            )
        )
        self.assertEqual(result.role_ceiling_decision, "Accepted")
        self.assertEqual(result.detected_role_level, "Junior")

    def test_zero_to_five_year_minimum_is_accepted(self) -> None:
        cases = (
            ("Senior Engineer", 3),
            ("Senior Engineer", 4),
            ("Senior Engineer", 5),
            ("Staff Engineer", 5),
        )

        for title, years in cases:
            with self.subTest(title=title, years=years):
                result = evaluate_role_ceiling(
                    make_job(
                        job_title=title,
                        job_description=(
                            f"Requires at least {years} years of experience."
                        ),
                    )
                )
                self.assertEqual(result.role_ceiling_decision, "Accepted")
                self.assertEqual(
                    result.minimum_required_experience_years,
                    years,
                )
                self.assertIsNone(result.maximum_required_experience_years)

    def test_six_or_more_year_minimum_is_rejected(self) -> None:
        cases = (("Senior Engineer", 6), ("Backend Engineer", 8))

        for title, years in cases:
            with self.subTest(title=title, years=years):
                result = evaluate_role_ceiling(
                    make_job(
                        job_title=title,
                        job_description=(
                            f"Requires at least {years} years of experience."
                        ),
                    )
                )
                self.assertEqual(result.role_ceiling_decision, "Rejected")

    def test_leadership_title_without_years_requires_manual_review(self) -> None:
        result = evaluate_role_ceiling(
            make_job(job_title="Head of Engineering")
        )
        self.assertEqual(result.role_ceiling_decision, "Manual review")
        self.assertEqual(result.detected_role_level, "Leadership")

    def test_experience_range_uses_the_actual_minimum(self) -> None:
        result = evaluate_role_ceiling(
            make_job(job_description="Candidates need 3-5 years experience.")
        )
        self.assertEqual(result.role_ceiling_decision, "Accepted")
        self.assertEqual(result.minimum_required_experience_years, 3)
        self.assertEqual(result.maximum_required_experience_years, 5)
