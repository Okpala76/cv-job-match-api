from unittest import TestCase

from app.geography import evaluate_geography
from app.schemas import AnalyzeMatchRequest


def make_job(**overrides: str) -> AnalyzeMatchRequest:
    values = {
        "company_name": "Example Company",
        "job_title": "Software Engineer",
        "country_location": "",
        "job_type": "Full-time",
        "job_level": "",
        "salary_text": "",
        "job_link": "https://example.com/job",
        "job_description": "Build and maintain software products.",
    }
    values.update(overrides)
    return AnalyzeMatchRequest(**values)


class TestGeography(TestCase):
    def test_african_locations_are_accepted(self) -> None:
        for location in (
            "Lagos, Nigeria",
            "Nairobi, Kenya",
            "Johannesburg, South Africa",
            "Accra, Ghana",
        ):
            with self.subTest(location=location):
                result = evaluate_geography(make_job(country_location=location))
                self.assertEqual(result.geography_decision, "Accepted")

    def test_remote_roles_explicitly_available_in_africa_are_accepted(
        self,
    ) -> None:
        for location in (
            "Remote - Africa",
            "Remote - Nigeria/Kenya/South Africa",
        ):
            with self.subTest(location=location):
                result = evaluate_geography(make_job(country_location=location))
                self.assertEqual(result.geography_decision, "Accepted")

        result = evaluate_geography(
            make_job(
                country_location="Remote",
                job_description="Open to candidates based anywhere in Africa.",
            )
        )
        self.assertEqual(result.geography_decision, "Accepted")

    def test_locations_clearly_outside_africa_are_rejected(self) -> None:
        for location in ("New York only", "London only"):
            with self.subTest(location=location):
                result = evaluate_geography(make_job(country_location=location))
                self.assertEqual(result.geography_decision, "Rejected")

    def test_unclear_remote_location_requires_manual_review(self) -> None:
        result = evaluate_geography(make_job(country_location="Remote"))
        self.assertEqual(result.geography_decision, "Manual review")
