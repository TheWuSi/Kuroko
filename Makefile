.PHONY: help dev-backend dev-frontend dev install-backend install-frontend lint test build clean

PYTHON ?= python3
NPM ?= npm

help: ## 显示帮助信息
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install-backend: ## 安装后端依赖
	cd backend && $(PYTHON) -m pip install -r requirements.txt

install-frontend: ## 安装前端依赖
	cd frontend && $(NPM) install

install: install-backend install-frontend ## 安装所有依赖

dev-backend: ## 启动后端开发服务器
	cd backend && $(PYTHON) -m app.serve --reload

dev-frontend: ## 启动前端开发服务器
	cd frontend && $(NPM) run dev

dev: ## 同时启动前后端（需要 make -j2）
	@echo "请使用 make -j2 dev-backend dev-frontend 同时启动前后端"

lint: ## 代码检查
	cd backend && $(PYTHON) -m ruff check .
	cd frontend && $(NPM) run lint

test: ## 运行测试
	cd backend && $(PYTHON) -m pytest

format: ## 格式化代码
	cd backend && $(PYTHON) -m ruff format .
	cd frontend && $(NPM) run format

build: ## 构建生产版本
	cd frontend && $(NPM) run build

clean: ## 清理构建产物
	rm -rf frontend/dist
	rm -rf backend/__pycache__
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
