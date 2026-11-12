"""Serve the built frontend (frontend/dist) from the API process, so production is one origin.

`/m/{slug}` share links get Open Graph tags with the map's title, so links unfurl nicely in chat apps.
In development the Vite dev server serves the frontend instead, and this module does nothing.
"""

from __future__ import annotations

import html
import mimetypes
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .errors import ApiError
from .models import Map

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; "
    "connect-src 'self'; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'; "
    "base-uri 'self'; form-action 'self'"
)


def _og_tags(title: str, description: str) -> str:
    t, d = html.escape(title, quote=True), html.escape(description, quote=True)
    return (
        f'<meta property="og:title" content="{t}" />'
        f'<meta property="og:description" content="{d}" />'
        f'<meta name="twitter:card" content="summary" />'
        f"<title>{t} · Terrachrome</title>"
    )


# Module workers need a JavaScript MIME type; GeoJSON and fonts get their proper types too.
for _type, _ext in (("text/javascript", ".mjs"), ("application/geo+json", ".geojson"), ("font/woff2", ".woff2")):
    mimetypes.add_type(_type, _ext)


def mount_spa(app: FastAPI, dist: Path) -> bool:
    index = dist / "index.html"
    if not index.exists():
        return False
    template = index.read_text(encoding="utf-8")
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    root = dist.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str, request: Request):
        if full_path.startswith("api/") or full_path == "api":
            raise ApiError(404, "not_found", "Not found.")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        page = template
        if full_path.startswith("m/"):
            slug = full_path[2:].split("/")[0][:16]
            with request.app.state.session_factory() as db:
                m = db.scalar(select(Map).where(Map.slug == slug))
            if m is not None and m.status == "ok":
                meta = m.meta or {}
                desc = f"{meta.get('metric_label') or 'AI-generated map'} ({meta.get('time_scope') or 'latest'}). AI-generated estimates; verify before citing."
                page = page.replace("<title>Terrachrome</title>", _og_tags(meta.get("title") or m.raw_query, desc), 1)
        return HTMLResponse(page, headers={"Content-Security-Policy": CSP, "Cache-Control": "no-cache"})

    return True
