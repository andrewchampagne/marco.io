# make              run the app in development (installs everything on first run)
# make setup        install backend + frontend dependencies
# make test         backend (pytest) + frontend (vitest) tests
# make bench        retrieval benchmark (needs ANTHROPIC_API_KEY; capped at $1)
# make screenshots  visual verification screenshots (Playwright)
# make build        production build of the frontend
# make start        production-style server: the backend serves the built frontend on :8000
# make data         rebuild the country dataset from Natural Earth
# make clean        remove backend/.venv, frontend/node_modules and frontend/dist
#
# No make? Every target is `python scripts/dev.py <target>`.

ifeq ($(OS),Windows_NT)
  SYSTEM_PYTHON ?= python
else
  SYSTEM_PYTHON ?= python3
endif
DEV := $(SYSTEM_PYTHON) scripts/dev.py

.PHONY: dev setup test bench screenshots build start data clean
.DEFAULT_GOAL := dev

dev:
	$(DEV) dev

setup:
	$(DEV) setup

test:
	$(DEV) test

bench:
	$(DEV) bench

screenshots:
	$(DEV) screenshots

build:
	$(DEV) build

start:
	$(DEV) start

data:
	$(DEV) data

clean:
	$(DEV) clean
