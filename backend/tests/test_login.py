"""Password protection used for online deployments (APP_PASSWORD)."""
import base64

from fastapi.testclient import TestClient

from app import main


def _auth(user: str, password: str) -> dict:
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}


def test_open_without_password(monkeypatch):
    monkeypatch.setattr(main, "_PASSWORD", "")
    assert TestClient(main.app).get("/api/aivideo/projects").status_code == 200


def test_password_required(monkeypatch):
    monkeypatch.setattr(main, "_PASSWORD", "s3cret")
    client = TestClient(main.app)
    r = client.get("/api/aivideo/projects")
    assert r.status_code == 401 and r.headers["www-authenticate"].startswith("Basic")
    assert client.get("/", headers=_auth("admin", "wrong")).status_code == 401
    assert client.get("/api/aivideo/projects", headers={"Authorization": "Basic !!!"}).status_code == 401
    assert client.get("/api/aivideo/projects", headers=_auth("admin", "s3cret")).status_code == 200
    assert client.get("/api/health").status_code == 200  # Render's health check
