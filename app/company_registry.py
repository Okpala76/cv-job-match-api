from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

CompanyTier = Literal["A", "B"]

_REGISTRY_PATH = Path(__file__).resolve().parent / "data" / "approved_companies.csv"
_TRAILING_CORPORATE_SUFFIXES = {
    "plc",
    "limited",
    "ltd",
    "inc",
    "incorporated",
    "llc",
    "company",
    "co",
}


@dataclass(frozen=True, slots=True)
class CompanyRecord:
    canonical_name: str
    aliases: tuple[str, ...]
    country: str
    industry: str
    company_tier: CompanyTier
    approval_basis: str
    source_url: str
    last_verified: str


@dataclass(frozen=True, slots=True)
class CompanyMatch:
    record: CompanyRecord
    matched_value: str


def normalize_company_name(value: str) -> str:
    """Normalize a company name for deterministic exact matching.

    This deliberately does not perform fuzzy or partial matching. The result
    must equal a canonical name or an explicitly registered alias after
    normalization.
    """

    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    normalized = normalized.lower().replace("&", " and ")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    words = normalized.split()

    while words and words[-1] in _TRAILING_CORPORATE_SUFFIXES:
        words.pop()

    return " ".join(words)


class ApprovedCompanyRegistry:
    def __init__(self, records: tuple[CompanyRecord, ...]) -> None:
        self._records = records
        self._lookup: dict[str, CompanyMatch] = {}

        for record in records:
            for candidate in (record.canonical_name, *record.aliases):
                key = normalize_company_name(candidate)

                if not key:
                    continue

                existing = self._lookup.get(key)
                if existing and existing.record.canonical_name != record.canonical_name:
                    raise RuntimeError(
                        "Approved-company registry contains a normalized-name "
                        f"collision for '{candidate}': "
                        f"'{existing.record.canonical_name}' and "
                        f"'{record.canonical_name}'."
                    )

                self._lookup[key] = CompanyMatch(
                    record=record,
                    matched_value=candidate,
                )

    @classmethod
    def from_csv(cls, path: Path = _REGISTRY_PATH) -> "ApprovedCompanyRegistry":
        if not path.exists():
            raise RuntimeError(f"Approved-company registry was not found: {path}")

        records: list[CompanyRecord] = []

        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)

            required_columns = {
                "canonical_name",
                "aliases",
                "country",
                "industry",
                "company_tier",
                "approved",
                "approval_basis",
                "source_url",
                "last_verified",
            }
            missing_columns = required_columns.difference(reader.fieldnames or [])

            if missing_columns:
                raise RuntimeError(
                    "Approved-company registry is missing columns: "
                    + ", ".join(sorted(missing_columns))
                )

            for row_number, row in enumerate(reader, start=2):
                if str(row.get("approved", "")).strip().lower() != "true":
                    continue

                country = str(row.get("country", "")).strip()
                tier = str(row.get("company_tier", "")).strip().upper()
                canonical_name = str(row.get("canonical_name", "")).strip()

                if country.lower() != "nigeria":
                    continue

                if tier not in {"A", "B"}:
                    raise RuntimeError(
                        f"Invalid company tier '{tier}' on registry row {row_number}."
                    )

                if not canonical_name:
                    raise RuntimeError(
                        f"Missing canonical company name on registry row {row_number}."
                    )

                aliases = tuple(
                    alias.strip()
                    for alias in str(row.get("aliases", "")).split("|")
                    if alias.strip()
                )

                records.append(
                    CompanyRecord(
                        canonical_name=canonical_name,
                        aliases=aliases,
                        country=country,
                        industry=str(row.get("industry", "")).strip(),
                        company_tier=tier,  # type: ignore[arg-type]
                        approval_basis=str(row.get("approval_basis", "")).strip(),
                        source_url=str(row.get("source_url", "")).strip(),
                        last_verified=str(row.get("last_verified", "")).strip(),
                    )
                )

        if not records:
            raise RuntimeError("Approved-company registry contains no active records.")

        return cls(tuple(records))

    def match(self, company_name: str) -> CompanyMatch | None:
        key = normalize_company_name(company_name)
        return self._lookup.get(key) if key else None

    @property
    def company_count(self) -> int:
        return len(self._records)


APPROVED_COMPANY_REGISTRY = ApprovedCompanyRegistry.from_csv()
