from app.models.target import Target

def test_target_creation_and_redaction(db_session):
    target = Target(
        name="Test API",
        type="http",
        host="https://api.test.com",
        config_json={"password": "secret_password", "custom": "value"}
    )
    db_session.add(target)
    db_session.commit()

    saved = db_session.query(Target).first()
    assert saved.name == "Test API"
    
    dict_repr = saved.to_dict()
    assert dict_repr["config_json"]["password"] == "••••••••"
    assert dict_repr["config_json"]["custom"] == "value"
    
    assert saved.config_json_raw()["password"] == "secret_password"
