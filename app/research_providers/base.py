from dataclasses import dataclass
from typing import Literal

from app.schemas import CompanyQualityScorecard, CompanyResearchResult


@dataclass(frozen=True)
class CompanyResearchAssessment:
    research: CompanyResearchResult
    scorecard: CompanyQualityScorecard
    provider: Literal["serper_groq", "gemini"]
    cacheable: bool = True
