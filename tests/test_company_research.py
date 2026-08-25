from google.genai import types

from app import company_research
from app.schemas import AnalyzeMatchRequest, CompanyResearchDraft


def make_job() -> AnalyzeMatchRequest:
    return AnalyzeMatchRequest(
        company_name="Example Company",
        job_title="Software Engineer",
        country_location="Nairobi, Kenya",
        job_link="https://example.com/job",
        job_description="Build payment systems.",
    )


def test_grounded_research_extracts_google_search_citations(monkeypatch) -> None:
    draft = CompanyResearchDraft(
        researched_company_name="Example Company",
        summary="A substantial regulated technology employer.",
        facts=["The company is publicly listed."],
        identity_ambiguous=False,
        sources_conflict=False,
        confidence="High",
    )
    response = types.GenerateContentResponse(
        parsed=draft,
        candidates=[
            types.Candidate(
                grounding_metadata=types.GroundingMetadata(
                    grounding_chunks=[
                        types.GroundingChunk(
                            web=types.GroundingChunkWeb(
                                uri="https://company.example/investors",
                                title="Investor relations",
                            )
                        ),
                        types.GroundingChunk(
                            web=types.GroundingChunkWeb(
                                uri="https://exchange.example/listing",
                                title="Stock exchange listing",
                            )
                        ),
                        types.GroundingChunk(
                            web=types.GroundingChunkWeb(
                                uri="https://unused.example/result",
                                title="Unused search result",
                            )
                        ),
                    ],
                    grounding_supports=[
                        types.GroundingSupport(
                            segment=types.Segment(
                                text="The company is publicly listed."
                            ),
                            grounding_chunk_indices=[0, 1],
                        )
                    ],
                )
            )
        ],
    )
    captured_config = None

    def fake_generate_content(*, model, contents, config):
        nonlocal captured_config
        captured_config = config
        return response

    monkeypatch.setattr(
        company_research.client.models,
        "generate_content",
        fake_generate_content,
    )

    result = company_research.research_company(make_job())

    assert captured_config.tools[0].google_search is not None
    assert result.company_sources == [
        "https://company.example/investors",
        "https://exchange.example/listing",
    ]
    assert len(result.company_evidence) == 2
    assert result.company_evidence[0].claim == "The company is publicly listed."
    assert "https://unused.example/result" not in result.company_sources
