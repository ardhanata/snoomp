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

def test_appearance_settings_validates_tag_colors_presets():
    from app.routes.settings import AppearanceSettings

    # Valid presets and custom hex colors
    s = AppearanceSettings(
        chart_1="#112233",
        chart_2="#445566",
        chart_3="#778899",
        tag_colors={"prod": "violet", "api": "TEAL", "custom": "#ff5500", "hex": "#10b981"}
    )
    assert s.tag_colors == {"prod": "violet", "api": "teal", "custom": "#ff5500", "hex": "#10b981"}

    # Invalid preset or non-hex string raises ValueError
    with pytest.raises(ValueError, match="Invalid tag color"):
        AppearanceSettings(
            chart_1="#112233",
            chart_2="#445566",
            chart_3="#778899",
            tag_colors={"prod": "neon_green"}
        )

