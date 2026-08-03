import os
from typing import TypeVar

from dotenv import load_dotenv
from google import genai
from google.genai import types

from pydantic import BaseModel

from app.cv_text import CV_TEXT
from app.schemas import (
    AIAnalysisResult,
    AIJobScreeningResult,
    AnalyzeMatchRequest,
)

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise RuntimeError("GEMINI_API_KEY environment variable is not set")

client = genai.Client(
    api_key=api_key,
    http_options=types.HttpOptions(
        timeout=30_000,
        retry_options=types.HttpRetryOptions(
            attempts=1,
        ),
    ),
)

MODEL_CANDIDATES = [
    "gemini-3.1-flash-lite",
    # "gemini-2.5-flash-lite",
    # "gemini-2.5-flash",
    # "gemini-3.5-flash",
]

SchemaType = TypeVar("SchemaType", bound=BaseModel)


def generate_structured_response(
    prompt: str,
    schema_class: type[SchemaType],
) -> SchemaType:
    """
    Try the configured Gemini models until one returns
    valid JSON matching the supplied Pydantic schema.
    """

    last_error: Exception | None = None

    for model in MODEL_CANDIDATES:
        print(
            f"[Gemini] Trying model: {model}",
            flush=True,
        )

        try:
            interaction = client.interactions.create(
                model=model,
                input=prompt,
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": schema_class.model_json_schema(),
                },
            )

            output_text = interaction.output_text

            if not output_text:
                raise RuntimeError(f"{model} returned no output text")

            result = schema_class.model_validate_json(output_text)

            print(
                f"[Gemini] Model succeeded: {model}",
                flush=True,
            )

            return result

        except Exception as error:
            last_error = error

            print(
                f"[Gemini] Model failed: {model}",
                flush=True,
            )

            print(
                f"[Gemini] Error: " f"{type(error).__name__}: {error}",
                flush=True,
            )

    raise RuntimeError(f"All Gemini models failed. Last error: {last_error}")


def screen_job_quality(
    job: AnalyzeMatchRequest,
) -> AIJobScreeningResult:
    """
    Decide whether the job appears both high-end and high-paying.

    This function does not compare the job to the CV.
    """

    prompt = f"""
You are screening job opportunities before a candidate applies.

Determine whether this job is BOTH:

1. A high-end role
2. A high-paying role

Return only JSON matching the provided schema.

STRICT HIGH-END RULES:

A role may be considered high-end when it clearly includes one or more
of the following:

- Senior, lead, staff, principal, architect or management-level responsibility
- Ownership of important systems, products, architecture or technical decisions
- Substantial engineering complexity
- Leadership, mentoring or strategic responsibility
- Strong professional experience requirements
- Significant business or technical impact

A role is not high-end when it is mainly:

- Internship
- Graduate programme
- Entry-level
- Junior
- Trainee
- Apprentice
- Assistant role
- Basic support-only work
- Low-responsibility administrative work
- Unpaid or volunteer work

STRICT HIGH-PAYING RULES:

- Use the disclosed salary when available.
- Judge compensation relative to the role, seniority and location.
- Do not assume a job is high-paying merely because the company is famous.
- Do not assume a job is high-paying merely because the title contains
  "senior".
- If compensation is not disclosed and there is not enough evidence,
  return "Unknown".
- If the disclosed compensation is clearly low for the location and
  responsibility, return "Not high-paying".
- Only return "High-paying" when there is reasonable evidence.

Important:

- Be conservative.
- Do not invent salary information.
- Do not invent company information.
- Keep screening reasons brief and factual.

Company:
{job.company_name or "Not provided"}

Job title:
{job.job_title or "Not provided"}

Location:
{job.country_location or "Not provided"}

Job type:
{job.job_type or "Not provided"}

Job level:
{job.job_level or "Not provided"}

Salary:
{job.salary_text or "Not disclosed"}

Job link:
{job.job_link or "Not provided"}

Job description:
{job.job_description}
"""

    return generate_structured_response(
        prompt=prompt,
        schema_class=AIJobScreeningResult,
    )


def analyze_cv_match(job_description: str) -> AIAnalysisResult:
    """
    Compare an accepted job against the hardcoded CV.

    Gemini supplies the match score and evidence.
    FastAPI will calculate the final match level and decision.
    """

    prompt = f"""
You are a strict CV-to-job matching assistant.

Compare the candidate CV against the job description.

Return only JSON matching the provided schema.

STRICT SCORING GUIDE:

90 to 100:
- Exceptional direct match
- Candidate clearly satisfies nearly all important requirements
- Required technologies and responsibilities are strongly represented
- Little or no substantial tailoring is needed

70 to 89:
- Good but incomplete match
- Candidate has many relevant skills
- Important skills, experience or responsibilities are still missing
- CV must be tailored before applying

0 to 69:
- Weak or insufficient match
- Too many important requirements are missing
- Role is outside the candidate's main experience
- Candidate should skip the role

Important:

- Be conservative with the score.
- Do not exaggerate skills.
- Do not award points for skills that are merely similar.
- Only list matched skills clearly present in both the CV and job description.
- Missing skills must be important requirements not clearly demonstrated
  in the CV.
- Do not automatically give a high score because the role is related to
  software development.
- A score of 90 or above should be rare.
- Tailoring advice should be short, specific and practical.
- Do not return match_level.
- Do not return decision.
- FastAPI will calculate the final classification.

Candidate CV:
{CV_TEXT}

Job description:
{job_description}
"""

    return generate_structured_response(
        prompt=prompt,
        schema_class=AIAnalysisResult,
    )
