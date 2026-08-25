from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AnalyzeMatchRequest(BaseModel):
    company_name: str = ""
    job_title: str = ""
    country_location: str = ""
    job_type: str = ""
    job_level: str = ""
    salary_text: str = ""
    job_link: str = ""
    job_description: str

    @field_validator("job_description")
    @classmethod
    def validate_job_description(cls, value: str) -> str:
        cleaned_value = value.strip()

        if not cleaned_value:
            raise ValueError("Job description cannot be empty")

        return cleaned_value


class GeographyResult(BaseModel):
    geography_decision: Literal["Accepted", "Rejected", "Manual review"]
    geography_reason: str = Field(min_length=1)


class RoleCeilingResult(BaseModel):
    role_ceiling_decision: Literal[
        "Accepted",
        "Rejected",
        "Manual review",
    ]

    detected_role_level: Literal[
        "Internship",
        "Graduate",
        "Entry-level",
        "Junior",
        "Mid-level",
        "Senior",
        "Leadership",
        "Unspecified",
    ]

    role_ceiling_reasons: list[str] = Field(min_length=1)

    minimum_required_experience_years: int | None = Field(
        default=None,
        ge=0,
    )

    maximum_required_experience_years: int | None = Field(
        default=None,
        ge=0,
    )


class AIAnalysisResult(BaseModel):
    match_percentage: int = Field(ge=0, le=100)
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    tailoring_advice: str


class AnalyzeMatchResponse(BaseModel):
    job_accepted: bool
    screening_decision: Literal["Accepted", "Rejected", "Manual review"]
    screening_reasons: list[str] = Field(default_factory=list)
    geography_decision: Literal["Accepted", "Rejected", "Manual review"]
    geography_reason: str
    salary_status: Literal["High-paying", "Not high-paying", "Unknown"] = "Unknown"
    job_quality_level: Literal["High-end", "Not high-end", "Unknown"] = "Unknown"

    company_status: Literal["Approved", "Not approved", "Unknown"] = "Unknown"
    matched_company_name: str | None = None
    company_tier: Literal["A", "B"] | None = None
    monthly_salary_ngn: int | None = Field(default=None, ge=0)
    role_ceiling_decision: (
        Literal[
            "Accepted",
            "Rejected",
            "Manual review",
        ]
        | None
    ) = None

    detected_role_level: (
        Literal[
            "Internship",
            "Graduate",
            "Entry-level",
            "Junior",
            "Mid-level",
            "Senior",
            "Leadership",
            "Unspecified",
        ]
        | None
    ) = None

    role_ceiling_reasons: list[str] = Field(default_factory=list)

    minimum_required_experience_years: int | None = Field(
        default=None,
        ge=0,
    )

    maximum_required_experience_years: int | None = Field(
        default=None,
        ge=0,
    )

    match_percentage: int | None = Field(default=None, ge=0, le=100)
    match_level: Literal["Strong", "Medium", "Weak"] | None = None
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    tailoring_advice: str = ""
    decision: Literal["Apply", "Tailor first", "Skip"]
