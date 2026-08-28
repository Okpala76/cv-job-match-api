import logging
import os
from typing import TypeVar

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

from app.cv_text import CV_TEXT
from app.schemas import AIAnalysisResult

load_dotenv()
logger = logging.getLogger(__name__)

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

MODEL_CANDIDATES = [os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")]

SchemaType = TypeVar("SchemaType", bound=BaseModel)


class AIProviderError(RuntimeError):
    """Raised when Gemini cannot provide a valid structured response."""


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
        logger.info("Trying Gemini model=%s", model)

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

            logger.info("Gemini model succeeded model=%s", model)

            return result

        except Exception as error:
            last_error = error

            logger.exception(
                "Gemini model failed model=%s (%s): %s",
                model,
                type(error).__name__,
                error,  # noqa: TRY401
            )

    raise AIProviderError(
        f"All Gemini models failed. Last error: {last_error}"
    ) from last_error


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
