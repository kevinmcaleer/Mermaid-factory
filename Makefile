# Common tasks. Run `make help` for the list.
PYTHON ?= python3
VENV   ?= .venv
BIN    := $(VENV)/bin

.PHONY: help install frontend dev test coverage lint format check-templates docker-up docker-down backup clean

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

$(BIN)/activate:
	$(PYTHON) -m venv $(VENV)

install: $(BIN)/activate ## Create the virtualenv and install Python + JS dependencies
	$(BIN)/pip install -r requirements-dev.txt
	cd frontend && npm ci

frontend: ## Build the browser bundle into app/static/build
	cd frontend && npm run build

dev: ## Run the app locally with auto-reload on http://127.0.0.1:8000
	@test -d app/static/build || $(MAKE) frontend
	RELOAD=true $(BIN)/python -m app

test: ## Run the test suite
	$(BIN)/pytest

coverage: ## Run the tests with a coverage report
	$(BIN)/pytest --cov --cov-report=term-missing

lint: ## Lint and check formatting
	$(BIN)/ruff check .
	$(BIN)/ruff format --check .

format: ## Auto-format the Python code
	$(BIN)/ruff check --fix .
	$(BIN)/ruff format .

check-templates: ## Render every gallery template in headless Chromium
	cd frontend && npm run check-templates

docker-up: ## Build and start with Docker Compose
	docker compose up -d --build

docker-down: ## Stop the Docker Compose stack
	docker compose down

backup: ## Take a consistent backup of the running app's database into ./backups
	docker compose exec -u app mermaid-factory scripts/backup.sh /data/mermaid.db /backups

clean: ## Remove caches and build output
	rm -rf .pytest_cache .ruff_cache .coverage htmlcov app/static/build
