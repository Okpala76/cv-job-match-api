import re

from app.schemas import AnalyzeMatchRequest, GeographyResult

_AFRICAN_LOCATIONS = (
    "africa",
    "algeria",
    "angola",
    "benin",
    "botswana",
    "burkina faso",
    "burundi",
    "cabo verde",
    "cape verde",
    "cameroon",
    "central african republic",
    "chad",
    "comoros",
    "democratic republic of the congo",
    "dr congo",
    "drc",
    "republic of the congo",
    "congo",
    "djibouti",
    "egypt",
    "equatorial guinea",
    "eritrea",
    "eswatini",
    "ethiopia",
    "gabon",
    "gambia",
    "ghana",
    "guinea",
    "guinea bissau",
    "ivory coast",
    "cote d ivoire",
    "kenya",
    "lesotho",
    "liberia",
    "libya",
    "madagascar",
    "malawi",
    "mali",
    "mauritania",
    "mauritius",
    "morocco",
    "mozambique",
    "namibia",
    "niger",
    "nigeria",
    "rwanda",
    "sao tome and principe",
    "senegal",
    "seychelles",
    "sierra leone",
    "somalia",
    "south africa",
    "south sudan",
    "sudan",
    "tanzania",
    "togo",
    "tunisia",
    "uganda",
    "zambia",
    "zimbabwe",
    "western sahara",
)

_CLEARLY_OUTSIDE_AFRICA = (
    "asia",
    "australia",
    "canada",
    "china",
    "europe",
    "european union",
    "france",
    "germany",
    "india",
    "ireland",
    "japan",
    "london",
    "new york",
    "new zealand",
    "north america",
    "paris",
    "singapore",
    "south america",
    "united arab emirates",
    "united kingdom",
    "united states",
    "uk",
    "us",
    "usa",
)

_AFRICA_EXCLUSIONS = (
    "excluding africa",
    "except africa",
    "not available in africa",
    "not open to candidates in africa",
)


def _normalize(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def _find_location(text: str, locations: tuple[str, ...]) -> str | None:
    padded_text = f" {_normalize(text)} "

    for location in locations:
        if f" {_normalize(location)} " in padded_text:
            return location

    return None


def evaluate_geography(job: AnalyzeMatchRequest) -> GeographyResult:
    location = job.country_location.strip()
    location_and_type = f"{location} {job.job_type}"
    remote = _find_location(location_and_type, ("remote",)) is not None
    remote_context = f"{location} {job.job_description}"

    if remote and _find_location(remote_context, _AFRICA_EXCLUSIONS):
        return GeographyResult(
            geography_decision="Rejected",
            geography_reason="Remote role explicitly excludes candidates in Africa.",
        )

    african_location = _find_location(location, _AFRICAN_LOCATIONS)

    if african_location:
        return GeographyResult(
            geography_decision="Accepted",
            geography_reason=f"Role is located in {location}.",
        )

    if remote:
        remote_african_location = _find_location(
            remote_context,
            _AFRICAN_LOCATIONS,
        )

        if remote_african_location:
            return GeographyResult(
                geography_decision="Accepted",
                geography_reason=(
                    "Remote role is explicitly available to candidates in Africa."
                ),
            )

    outside_location = _find_location(location, _CLEARLY_OUTSIDE_AFRICA)

    if outside_location:
        return GeographyResult(
            geography_decision="Rejected",
            geography_reason=(
                f"Role is restricted to {location}, outside Africa."
            ),
        )

    if remote:
        reason = "Remote role does not clearly state that candidates in Africa are eligible."
    elif location:
        reason = f"Could not confidently determine whether {location} is in Africa."
    else:
        reason = "Job location was not provided."

    return GeographyResult(
        geography_decision="Manual review",
        geography_reason=reason,
    )
