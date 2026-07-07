from pydantic import BaseModel, Field


class AnalyzeMatchRequest(BaseModel):
    job_description: str = Field(min_length=1)


class AnalyzeMatchResponse(BaseModel):
    match_percentage: int
    match_level: str
    matched_skills: list[str]
    missing_skills: list[str]
    tailoring_advice: str
    decision: str
