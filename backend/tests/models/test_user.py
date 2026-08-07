from app.models.user import User
from app.auth.security import get_password_hash, verify_password

def test_user_creation_and_auth(db_session):
    user = User(
        username="admin",
        hashed_password=get_password_hash("password123"),
        role="admin"
    )
    db_session.add(user)
    db_session.commit()

    saved = db_session.query(User).first()
    # The default DB initialization also creates an admin user, so we might have two users here.
    # We should query specifically for our test user to be safe if the DB is seeded.
    # Actually db_session from conftest creates tables but doesn't run init_db(), so the table is empty.
    assert saved.username == "admin"
    assert saved.is_active is True
    assert verify_password("password123", saved.hashed_password) is True
