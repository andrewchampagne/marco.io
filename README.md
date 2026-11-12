# Terrachrome

Ask a question about the world ("How many deaths were there in each country in World War 1?",
"Average annual rainfall by country") and get a dark, interactive choropleth map. One LLM call fetches a
value for every country it has data for. The backend validates the result, fills in N/A, bins it, and the
map renders it.

> Work in progress. See [PLAN.md](PLAN.md) for the build plan and phase status, and
> [docs/DECISIONS.md](docs/DECISIONS.md) for design decisions. Full setup instructions land in Phase 6.

## Layout

| Path | What lives there |
|---|---|
| `backend/` | FastAPI app, LLM client, quotas, auth, tests, retrieval benchmark |
| `frontend/` | React + TypeScript + Vite + Tailwind + MapLibre GL JS |
| `data/` | Country polygons and the canonical country list (Natural Earth, public domain) |
| `docs/` | Decisions, retrieval benchmark, screenshots |
