"""Production mode: the API process serves the built frontend, with OG tags on share links."""

import pytest
from starlette.testclient import TestClient

from app.main import create_app

from .conftest import make_map, make_settings

INDEX = "<!doctype html><html><head><title>Terrachrome</title></head><body><div id=root></div></body></html>"


@pytest.fixture
def prod(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX, encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)" + " " * 2000, encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("do not serve", encoding="utf-8")
    app = create_app(make_settings(tmp_path), frontend_dist=dist)
    with TestClient(app, base_url="https://testserver") as client:
        yield client


def test_index_and_client_routes_serve_the_app_with_csp(prod):
    for path in ("/", "/m/unknown1", "/some/client/route"):
        r = prod.get(path)
        assert r.status_code == 200 and "<div id=root>" in r.text
        assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_share_link_gets_open_graph_tags(prod):
    _, _, data = make_map(prod, "How many deaths were there in each country in World War 1?")
    page = prod.get(f"/m/{data['slug']}").text
    assert '<meta property="og:title" content="World War I Deaths by Country"' in page
    assert "verify before citing" in page
    assert "<title>World War I Deaths by Country · Terrachrome</title>" in page


def test_static_files_and_api_404s(prod):
    assert prod.get("/assets/app.js").status_code == 200
    assert prod.get("/favicon.svg").text == "<svg/>"
    r = prod.get("/api/does-not-exist")
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_no_path_traversal_out_of_dist(prod):
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"):
        r = prod.get(path)
        assert "do not serve" not in r.text


def test_gzip_for_json_and_static_but_not_for_sse(prod):
    _, _, data = make_map(prod, "Population by country")
    r = prod.get(f"/api/maps/{data['slug']}", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
    stream = prod.post("/api/maps", json={"query": "Average annual rainfall"},
                       headers={"X-Requested-With": "t", "Accept-Encoding": "gzip"})
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert "content-encoding" not in stream.headers
