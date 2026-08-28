from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

LOW_CREDIBILITY_HOSTS = {
    "blogspot.com",
    "facebook.com",
    "medium.com",
    "quora.com",
    "reddit.com",
    "twitter.com",
    "wordpress.com",
    "x.com",
}


def normalize_public_url(value: str | None) -> str | None:
    if not value:
        return None

    parsed = urlparse(value.strip())

    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None

    query = urlencode(
        [
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_")
        ]
    )
    path = parsed.path.rstrip("/") or ""

    return urlunparse(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            path,
            "",
            query,
            "",
        )
    )


def is_credible_source(url: str) -> bool:
    normalized = normalize_public_url(url)

    if not normalized:
        return False

    hostname = (urlparse(normalized).hostname or "").lower()
    return not any(
        hostname == blocked or hostname.endswith(f".{blocked}")
        for blocked in LOW_CREDIBILITY_HOSTS
    )
