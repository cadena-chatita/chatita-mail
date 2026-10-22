"""A missing Google service-account file must answer 503 with a clear message, not a bare 500."""
from fastapi.testclient import TestClient

from backend.main import app


def test_missing_service_account_is_a_clear_503():
    @app.get("/__probe_sa")
    async def probe():  # noqa: ANN202
        raise FileNotFoundError("[Errno 2] No such file or directory: '/x/chatita-service-account.json'")

    r = TestClient(app, raise_server_exceptions=False).get("/__probe_sa")
    assert r.status_code == 503 and "Gmail no está configurado" in r.json()["detail"]
