from app.company_registry import APPROVED_COMPANY_REGISTRY, normalize_company_name


def test_registry_loads_seed_companies() -> None:
    assert APPROVED_COMPANY_REGISTRY.company_count == 118


def test_matches_canonical_company_name() -> None:
    match = APPROVED_COMPANY_REGISTRY.match("Access Bank Plc")
    assert match is not None
    assert match.record.canonical_name == "Access Bank Plc"
    assert match.record.company_tier == "A"


def test_matches_registered_alias_case_insensitively() -> None:
    match = APPROVED_COMPANY_REGISTRY.match("gtbank")
    assert match is not None
    assert match.record.canonical_name == "Guaranty Trust Holding Company Plc"


def test_normalization_removes_punctuation_and_trailing_suffix() -> None:
    assert normalize_company_name("  Access-Bank, PLC ") == "access bank"


def test_unknown_company_does_not_match() -> None:
    assert APPROVED_COMPANY_REGISTRY.match("Unknown Small Company") is None
