from types import SimpleNamespace

import pytest

from app.ai_client import AIProviderError
from app.research_providers import serper_groq
from app.schemas import AnalyzeMatchRequest


def make_job() -> AnalyzeMatchRequest:
    return AnalyzeMatchRequest(
        company_name="Example Company",
        job_title="Software Engineer",
        country_location="Lagos, Nigeria",
        job_link="https://example.com/job",
        job_description="Build software products.",
    )


def make_evaluation(**overrides) -> serper_groq.GroqCompanyEvaluation:
    values = {
        "resolved_company_name": "Example Company",
        "identity_ambiguous": False,
        "source_conflict": False,
        "company_scale_score": 27,
        "company_market_position_score": 22,
        "company_geographic_reach_score": 12,
        "company_engineering_maturity_score": 15,
        "company_reputation_score": 8,
        "confidence": "High",
        "reasons": ["Strong public evidence."],
        "evidence": [
            {
                "claim": "The company publishes an annual report.",
                "source_url": "https://company.example/report",
                "source_title": "Annual report",
            },
            {
                "claim": "The company is regulated.",
                "source_url": "https://regulator.example/record",
                "source_title": "Regulatory record",
            },
        ],
    }
    values.update(overrides)
    return serper_groq.GroqCompanyEvaluation(**values)


def test_primary_uses_three_targeted_searches(monkeypatch) -> None:
    queries = []

    def fake_search(query):
        queries.append(query)
        return [
            {
                "title": "Annual report",
                "link": "https://company.example/report",
                "snippet": "Large established company.",
            },
            {
                "title": "Regulatory record",
                "link": "https://regulator.example/record",
                "snippet": "Regulated company.",
            },
        ]

    monkeypatch.setattr(serper_groq, "_search_serper", fake_search)
    monkeypatch.setattr(
        serper_groq,
        "_evaluate_with_groq",
        lambda job, evidence: make_evaluation(),
    )

    assessment = serper_groq.research_with_serper_groq(make_job())

    assert len(queries) == 3
    assert "employees revenue assets funding company profile" in queries[0]
    assert "market leader operations countries Africa customers" in queries[1]
    assert "engineering technology software careers jobs" in queries[2]
    assert assessment.provider == "serper_groq"


def test_duplicate_search_urls_are_counted_once() -> None:
    normalized = serper_groq.normalize_search_results(
        [
            (
                "query one",
                [
                    {
                        "title": "Company",
                        "link": "https://company.example/about/?utm_source=search",
                        "snippet": "Official profile.",
                    }
                ],
            ),
            (
                "query two",
                [
                    {
                        "title": "Company duplicate",
                        "link": "https://company.example/about",
                        "snippet": "The same profile.",
                    }
                ],
            ),
        ]
    )

    assert len(normalized) == 1
    assert normalized[0].url == "https://company.example/about"


def test_unknown_groq_evidence_url_is_discarded() -> None:
    supplied = [
        serper_groq.SearchEvidence(
            title="Annual report",
            url="https://company.example/report",
            snippet="Official report.",
            source="company.example",
            query="company scale",
        )
    ]
    evaluation = make_evaluation(
        evidence=[
            {
                "claim": "Supported claim.",
                "source_url": "https://company.example/report",
                "source_title": "Annual report",
            },
            {
                "claim": "Invented claim.",
                "source_url": "https://invented.example/source",
                "source_title": "Invented source",
            },
        ]
    )

    assessment = serper_groq._normalize_evaluation(evaluation, supplied)

    assert assessment.research.company_sources == ["https://company.example/report"]
    assert len(assessment.research.company_evidence) == 1


def test_groq_uses_strict_structured_output(monkeypatch) -> None:
    captured = {}
    content = make_evaluation().model_dump_json()

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(message=SimpleNamespace(content=content))
                ]
            )

    class FakeGroq:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(serper_groq, "Groq", FakeGroq)
    evidence = [
        serper_groq.SearchEvidence(
            title="Annual report",
            url="https://company.example/report",
            snippet="Official report.",
            source="company.example",
            query="company scale",
        )
    ]

    serper_groq._evaluate_with_groq(make_job(), evidence)

    assert captured["model"] == "openai/gpt-oss-20b"
    assert captured["response_format"]["json_schema"]["strict"] is True
    schema = captured["response_format"]["json_schema"]["schema"]
    assert schema["additionalProperties"] is False


def test_unsupported_groq_model_uses_validated_best_effort_schema(
    monkeypatch,
) -> None:
    captured = {}
    content = make_evaluation().model_dump_json()

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    class FakeGroq:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(serper_groq, "Groq", FakeGroq)
    monkeypatch.setattr(serper_groq, "GROQ_MODEL", "other/model")

    serper_groq._evaluate_with_groq(make_job(), [])

    assert captured["response_format"]["json_schema"]["strict"] is False


def test_serper_429_retries_once_then_stops(monkeypatch) -> None:
    calls = 0

    def fake_post(*args, **kwargs):
        nonlocal calls
        calls += 1
        return SimpleNamespace(status_code=429)

    monkeypatch.setattr(serper_groq.requests, "post", fake_post)
    monkeypatch.setattr(serper_groq.time, "sleep", lambda delay: None)

    with pytest.raises(AIProviderError, match="HTTP 429"):
        serper_groq._search_serper("company query")

    assert calls == 2


def test_groq_429_retries_once_then_stops(monkeypatch) -> None:
    calls = 0

    class QuotaError(Exception):
        status_code = 429

    class FakeCompletions:
        def create(self, **kwargs):
            nonlocal calls
            calls += 1
            raise QuotaError("quota exhausted")

    class FakeGroq:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(serper_groq, "Groq", FakeGroq)
    monkeypatch.setattr(serper_groq.time, "sleep", lambda delay: None)

    with pytest.raises(AIProviderError, match="quota exhausted"):
        serper_groq._evaluate_with_groq(make_job(), [])

    assert calls == 2
