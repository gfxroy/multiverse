.DEFAULT_GOAL := help
PY := backend/.venv/bin

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install backend (venv) and frontend dependencies
	cd backend && python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]"
	cd frontend && npm ci

dev: ## Run backend + frontend with hot reload (http://localhost:5173)
	./scripts/dev.sh

backend: ## Run only the API on :8000
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

frontend: ## Run only the Vite dev server on :5173
	cd frontend && npm run dev

test: ## Run backend and frontend tests
	cd backend && .venv/bin/pytest -q
	cd frontend && npm test

lint: ## Lint + type-check everything
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app
	cd frontend && npm run lint && npm run format:check && npm run typecheck

format: ## Auto-format backend and frontend
	cd backend && .venv/bin/ruff format . && .venv/bin/ruff check --fix .
	cd frontend && npm run format

build: ## Production build of the frontend
	cd frontend && npm run build

up: ## docker compose up --build (http://localhost:8080)
	docker compose up --build

screenshots: ## Regenerate docs/ screenshots (app must be running on :5173)
	python3 scripts/screenshots.py --url http://localhost:5173 --out docs

.PHONY: help install dev backend frontend test lint format build up screenshots
