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


class AIJobScreeningResult(BaseModel):
    job_quality_level: Literal[
        "High-end",
        "Not high-end",
        "Unknown",
    ]

    salary_status: Literal[
        "High-paying",
        "Not high-paying",
        "Unknown",
    ]

    screening_reasons: list[str] = Field(min_length=1)


class AIAnalysisResult(BaseModel):
    match_percentage: int = Field(ge=0, le=100)
    matched_skills: list[str]
    missing_skills: list[str]
    tailoring_advice: str


class AnalyzeMatchResponse(BaseModel):
    job_accepted: bool

    screening_decision: Literal[
        "Accepted",
        "Rejected",
        "Manual review",
    ]

    screening_reasons: list[str]

    salary_status: Literal[
        "High-paying",
        "Not high-paying",
        "Unknown",
    ]

    job_quality_level: Literal[
        "High-end",
        "Not high-end",
        "Unknown",
    ]

    match_percentage: int | None = None

    match_level: (
        Literal[
            "Strong",
            "Medium",
            "Weak",
        ]
        | None
    ) = None

    matched_skills: list[str] = []
    missing_skills: list[str] = []
    tailoring_advice: str = ""

    decision: Literal[
        "Apply",
        "Tailor first",
        "Skip",
    ]
