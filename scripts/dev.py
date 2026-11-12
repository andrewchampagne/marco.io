"""Cross-platform task runner, so a fresh clone works with or without `make`.

    python scripts/dev.py            same as `dev`
    python scripts/dev.py dev        install what's missing, then run the API (:8000) and the web app (:5173)
    python scripts/dev.py setup      create backend/.venv and install backend + frontend dependencies
    python scripts/dev.py test       backend tests (pytest) + frontend tests (vitest)
    python scripts/dev.py bench      retrieval benchmark (needs ANTHROPIC_API_KEY; capped at $1)
    python scripts/dev.py screenshots   visual verification screenshots (Playwright)
    python scripts/dev.py build      production build of the frontend (served by the backend)
    python scripts/dev.py start      production-style server: the backend serves the built frontend on :8000
    python scripts/dev.py data       rebuild data/countries.* from Natural Earth
    python scripts/dev.py clean      remove backend/.venv, frontend/node_modules and frontend/dist

On first run it creates `.env` from `.env.example` with a fresh random SESSION_SECRET. The defaults
(LLM_MODE=mock, AUTH_MODE=mock) need no API key and no Google project.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
IS_WINDOWS = os.name == "nt"
VENV_PY = VENV / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
API_PORT = int(os.environ.get("API_PORT", "8000"))
WEB_PORT = int(os.environ.get("WEB_PORT", "5173"))


def say(msg: str) -> None:
    print(f"\033[36m[terrachrome]\033[0m {msg}", flush=True)


def run(cmd: list[str], cwd: Path, env: dict | None = None) -> None:
    say(" ".join(str(c) for c in cmd))
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def npm() -> str:
    exe = shutil.which("npm")
    if not exe:
        sys.exit("npm was not found. Install Node.js 20+ from https://nodejs.org and try again.")
    return exe


def fingerprint(*files: Path) -> str:
    h = hashlib.sha256()
    for f in files:
        if f.exists():
            h.update(f.read_bytes())
    return h.hexdigest()[:16]


def ensure_env() -> None:
    env_file = ROOT / ".env"
    if env_file.exists():
        return
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    text = text.replace("SESSION_SECRET=change-me-to-a-long-random-string", f"SESSION_SECRET={secrets.token_urlsafe(48)}")
    env_file.write_text(text, encoding="utf-8")
    say("Created .env from .env.example (mock AI + mock Google sign-in; no keys needed)")


def ensure_backend() -> None:
    if sys.version_info < (3, 12):
        sys.exit(f"Python 3.12+ is required (this is {sys.version.split()[0]}).")
    stamp = VENV / f".installed-{fingerprint(BACKEND / 'requirements.txt', BACKEND / 'requirements-dev.txt')}"
    if stamp.exists():
        return
    if not VENV_PY.exists():
        say("Creating backend/.venv")
        venv.create(VENV, with_pip=True)
    run([str(VENV_PY), "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements-dev.txt"], BACKEND)
    for old in VENV.glob(".installed-*"):
        old.unlink()
    stamp.touch()


def ensure_frontend() -> None:
    if not (FRONTEND / "package.json").exists():
        return
    lock = FRONTEND / "package-lock.json"
    stamp = FRONTEND / "node_modules" / f".installed-{fingerprint(FRONTEND / 'package.json', lock)}"
    if stamp.exists():
        return
    run([npm(), "ci" if lock.exists() else "install", "--no-audit", "--no-fund"], FRONTEND)
    for old in (FRONTEND / "node_modules").glob(".installed-*"):
        old.unlink()
    stamp.touch()


def setup() -> None:
    ensure_env()
    ensure_backend()
    ensure_frontend()


def _pump(prefix: str, color: str, proc: subprocess.Popen) -> None:
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode("utf-8", "replace").rstrip()
        print(f"\033[{color}m{prefix}\033[0m {line}", flush=True)


def _kill(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if IS_WINDOWS:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def run_together(procs: list[tuple[str, str, list[str], Path]]) -> None:
    running: list[subprocess.Popen] = []
    try:
        for prefix, color, cmd, cwd in procs:
            kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WINDOWS else {"start_new_session": True}
            p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
            threading.Thread(target=_pump, args=(prefix, color, p), daemon=True).start()
            running.append(p)
        while all(p.poll() is None for p in running):
            time.sleep(0.4)
        say("A process exited; stopping the others.")
    except KeyboardInterrupt:
        say("Stopping…")
    finally:
        for p in running:
            _kill(p)


def dev() -> None:
    setup()
    procs = [("[api]", "35", [str(VENV_PY), "-m", "uvicorn", "app.main:app", "--reload", "--port", str(API_PORT)], BACKEND)]
    if (FRONTEND / "package.json").exists():
        procs.append(("[web]", "32", [npm(), "run", "dev", "--", "--port", str(WEB_PORT), "--strictPort"], FRONTEND))
        say(f"Open http://localhost:{WEB_PORT}")
    run_together(procs)


def test() -> None:
    setup()
    run([str(VENV_PY), "-m", "pytest"], BACKEND)
    if (FRONTEND / "package.json").exists():
        run([npm(), "test"], FRONTEND)


def bench() -> None:
    ensure_backend()
    run([str(VENV_PY), "-m", "bench.run", *sys.argv[2:]], BACKEND)


def build() -> None:
    setup()
    run([npm(), "run", "build"], FRONTEND)


def start() -> None:
    build()
    say(f"Serving the built app on http://localhost:{API_PORT}")
    run_together([("[app]", "35", [str(VENV_PY), "-m", "uvicorn", "app.main:app", "--port", str(API_PORT)], BACKEND)])


def screenshots() -> None:
    setup()
    run([npm(), "run", "screenshots"], FRONTEND)


def data() -> None:
    run([sys.executable, "-I", str(ROOT / "data" / "build_countries.py"), *sys.argv[2:]], ROOT)


def clean() -> None:
    for path in (VENV, FRONTEND / "node_modules", FRONTEND / "dist"):
        if path.exists():
            say(f"Removing {path.relative_to(ROOT)}")
            shutil.rmtree(path, ignore_errors=True)


COMMANDS = {f.__name__: f for f in (dev, setup, test, bench, build, start, screenshots, data, clean)}

if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if name not in COMMANDS:
        sys.exit(f"Unknown command {name!r}. Choose one of: {', '.join(COMMANDS)}")
    try:
        COMMANDS[name]()
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.returncode)
