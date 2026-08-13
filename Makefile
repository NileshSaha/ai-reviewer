.PHONY: up down logs logs_200 restart

up:
	docker compose up -d --force-recreate

down:
	docker compose down

logs:
	docker compose logs -f ai-reviewer

logs_200:
	docker compose logs --tail=200 -f ai-reviewer

restart: down up
