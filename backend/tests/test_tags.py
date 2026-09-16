import pytest
from app.models.target import Target, normalize_tags
from app.routes.targets import TargetCreateUpdate

def test_normalize_tags_lowercase_and_strip():
    assert normalize_tags(["PROD"]) == ["prod"]
    assert normalize_tags(["  PROD  ", "  web  "]) == ["prod", "web"]
    assert normalize_tags("PROD, staging, Prod") == ["prod", "staging"]
    assert normalize_tags(["PROD", "prod", "Prod"]) == ["prod"]
    assert normalize_tags([]) == []
    assert normalize_tags(None) == []
    assert normalize_tags(["", "   ", "prod"]) == ["prod"]

def test_target_model_validates_and_normalizes_tags():
    target = Target(
        name="Production Server",
        type="http",
        host="prod.example.com",
        tags=["PROD", "Web", "prod", "WEB"]
    )
    # Target model should normalize and deduplicate tags via validator
    assert target.tags == ["prod", "web"]
    data = target.to_dict()
    assert data["tags"] == ["prod", "web"]

    # Test reassignment
    target.tags = ["API", "api", "PROD"]
    assert target.tags == ["api", "prod"]

def test_target_create_update_schema_normalizes_tags():
    schema = TargetCreateUpdate(
        name="Test Monitor",
        type="http",
        host="test.example.com",
        tags=["PROD", "prod", "DATABASE", "database"]
    )
    assert schema.tags == ["prod", "database"]
