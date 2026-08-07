from app.services.dashboard import compile_initial_data
from app.models.target import Target

def test_compile_initial_data_type(db_session):
    data = compile_initial_data(db_session)
    assert isinstance(data, list)

def test_compile_initial_data_with_target(db_session):
    target = Target(name="TestDashboardTarget", type="ping", host="127.0.0.1", enabled=True, check_interval=60)
    db_session.add(target)
    db_session.commit()
    
    data = compile_initial_data(db_session)
    # Find our specific target
    item = next((d for d in data if d["name"] == "TestDashboardTarget"), None)
    assert item is not None
    assert item["status"] == "down" # no heartbeats yet
