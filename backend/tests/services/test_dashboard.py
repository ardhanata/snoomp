from app.services.dashboard import compile_initial_data
from app.models.target import Target

def test_compile_initial_data_empty(db_session):
    data = compile_initial_data(db_session)
    assert isinstance(data, list)
    assert len(data) == 0

def test_compile_initial_data_with_target(db_session):
    target = Target(name="Test", type="ping", host="127.0.0.1", enabled=True, check_interval=60)
    db_session.add(target)
    db_session.commit()
    
    data = compile_initial_data(db_session)
    assert len(data) == 1
    assert data[0]["name"] == "Test"
    assert data[0]["status"] == "down" # no heartbeats yet
