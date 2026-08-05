from unittest import TestCase

from app.role_ceiling import evaluate_role_ceiling
from app.schemas import AnalyzeMatchRequest


def make_job(
    **overrides: str,
) -> AnalyzeMatchRequest:
    values = {
        "company_name": "Access Bank",
        "job_title": "Software Engineer",
        "country_location": "Lagos, Nigeria",
        "job_type": "Full-time",
        "job_level": "",
        "salary_text": "",
        "job_link": "https://example.com/job",
        "job_description": ("Build and maintain software products."),
    }

    values.update(overrides)

    return AnalyzeMatchRequest(**values)


class TestRoleCeiling(TestCase):
    def test_junior_role_is_accepted(
        self,
    ) -> None:
        result = evaluate_role_ceiling(
            make_job(
                job_title=("Junior Software Engineer"),
                job_description=("Requires 1 year of relevant " "experience."),
            )
        )

        self.assertEqual(
            result.role_ceiling_decision,
            "Accepted",
        )

        self.assertEqual(
            result.detected_role_level,
            "Junior",
        )

    def test_four_year_role_is_accepted(
        self,
    ) -> None:
        result = evaluate_role_ceiling(
            make_job(
                job_description=(
                    "Requires at least 4 years of " "professional experience."
                )
            )
        )

        self.assertEqual(
            result.role_ceiling_decision,
            "Accepted",
        )

        self.assertEqual(
            result.minimum_required_experience_years,
            4,
        )

    def test_senior_role_requires_review(
        self,
    ) -> None:
        result = evaluate_role_ceiling(
            make_job(
                job_title=("Senior Backend Engineer"),
                job_description=("Requires 3+ years of backend " "experience."),
            )
        )

        self.assertEqual(
            result.role_ceiling_decision,
            "Manual review",
        )

        self.assertEqual(
            result.detected_role_level,
            "Senior",
        )

    def test_five_year_role_is_rejected(
        self,
    ) -> None:
        result = evaluate_role_ceiling(
            make_job(
                job_description=(
                    "Requires a minimum of 5 years " "of software experience."
                )
            )
        )

        self.assertEqual(
            result.role_ceiling_decision,
            "Rejected",
        )

        self.assertEqual(
            result.minimum_required_experience_years,
            5,
        )

    def test_staff_role_is_rejected(
        self,
    ) -> None:
        result = evaluate_role_ceiling(make_job(job_title=("Staff Software Engineer")))

        self.assertEqual(
            result.role_ceiling_decision,
            "Rejected",
        )

        self.assertEqual(
            result.detected_role_level,
            "Leadership",
        )

    def test_unpaid_role_is_rejected(
        self,
    ) -> None:
        result = evaluate_role_ceiling(
            make_job(
                job_title=("Software Engineering Intern"),
                job_description=("This is an unpaid internship."),
            )
        )

        self.assertEqual(
            result.role_ceiling_decision,
            "Rejected",
        )

    def test_three_to_five_year_range(
        self,
    ) -> None:
        result = evaluate_role_ceiling(
            make_job(
                job_description=("Candidates should have " "3-5 years experience.")
            )
        )

        self.assertEqual(
            result.role_ceiling_decision,
            "Accepted",
        )

        self.assertEqual(
            result.minimum_required_experience_years,
            3,
        )

        self.assertEqual(
            result.maximum_required_experience_years,
            5,
        )
