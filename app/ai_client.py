import os

from dotenv import load_dotenv
from google import genai

from app.cv_text import CV_TEXT
from app.schemas import AIAnalysisResult

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def analyze_cv_match(job_description: str) -> AIAnalysisResult:
    prompt = f"""
You are a CV-to-job matching assistant.

Compare the candidate CV against the job description.

Return only JSON matching the provided schema.

Scoring guide:
- 75 to 100 = strong match
- 55 to 74 = medium match
- below 55 = weak match

Important:
- Be realistic.
- Do not exaggerate skills.
- Only list matched skills that are clearly present in both the CV and job description.
- Missing skills should be important skills from the job description that are not clearly shown in the CV.
- Tailoring advice should be short and practical.

Candidate CV:
{CV_TEXT}

Job Description:
{job_description}
"""

    interaction = client.interactions.create(
        model="gemini-3.5-flash",
        input=prompt,
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": AIAnalysisResult.model_json_schema(),
        },
    )

    return AIAnalysisResult.model_validate_json(interaction.output_text)
