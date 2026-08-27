from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


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


class CompanyEvidence(BaseModel):
    claim: str = Field(min_length=1)
    source_url: str = Field(min_length=1)
    source_title: str = ""


class CompanyResearchDraft(BaseModel):
    researched_company_name: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    facts: list[str] = Field(default_factory=list)
    identity_ambiguous: bool = False
    sources_conflict: bool = False
    confidence: Literal["High", "Medium", "Low"]


class CompanyResearchResult(CompanyResearchDraft):
    company_evidence: list[CompanyEvidence] = Field(default_factory=list)
    company_sources: list[str] = Field(default_factory=list)


class CompanyQualityScorecard(BaseModel):
    company_scale_score: int = Field(ge=0, le=30)
    company_market_position_score: int = Field(ge=0, le=25)
    company_geographic_reach_score: int = Field(ge=0, le=15)
    company_engineering_maturity_score: int = Field(ge=0, le=20)
    company_reputation_score: int = Field(ge=0, le=10)
    company_quality_reasons: list[str] = Field(min_length=1)


class CompanyQualityResult(CompanyQualityScorecard):
    company_quality_decision: Literal["Accepted", "Rejected", "Manual review"]
    company_quality_score: int = Field(ge=0, le=100)
    company_evidence: list[CompanyEvidence] = Field(default_factory=list)
    company_sources: list[str] = Field(default_factory=list)
    company_confidence: Literal["High", "Medium", "Low"]

    @model_validator(mode="after")
    def validate_total_score(self) -> "CompanyQualityResult":
        component_total = (
            self.company_scale_score
            + self.company_market_position_score
            + self.company_geographic_reach_score
            + self.company_engineering_maturity_score
            + self.company_reputation_score
        )

        if self.company_quality_score != component_total:
            raise ValueError("Company quality score must equal its component scores")

        cited_sources = {evidence.source_url for evidence in self.company_evidence}
        accepted_sources = set(self.company_sources) & cited_sources

        if self.company_quality_decision == "Accepted" and (
            self.company_quality_score < 70
            or self.company_scale_score < 20
            or len(accepted_sources) < 2
            or self.company_confidence == "Low"
        ):
            raise ValueError("Accepted company result does not meet required gates")

        return self


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

    company_quality_decision: (
        Literal["Accepted", "Rejected", "Manual review"] | None
    ) = None
    company_quality_score: int | None = Field(default=None, ge=0, le=100)
    company_scale_score: int | None = Field(default=None, ge=0, le=30)
    company_market_position_score: int | None = Field(default=None, ge=0, le=25)
    company_geographic_reach_score: int | None = Field(default=None, ge=0, le=15)
    company_engineering_maturity_score: int | None = Field(
        default=None,
        ge=0,
        le=20,
    )
    company_reputation_score: int | None = Field(default=None, ge=0, le=10)
    company_quality_reasons: list[str] = Field(default_factory=list)
    company_evidence: list[CompanyEvidence] = Field(default_factory=list)
    company_sources: list[str] = Field(default_factory=list)
    company_confidence: Literal["High", "Medium", "Low"] | None = None

    match_percentage: int | None = Field(default=None, ge=0, le=100)
    match_level: Literal["Strong", "Medium", "Weak"] | None = None
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    tailoring_advice: str = ""
    decision: Literal["Apply", "Tailor first", "Skip"]
