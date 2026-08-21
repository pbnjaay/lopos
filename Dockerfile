FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir .

COPY backend ./backend

EXPOSE 8000

# Utilisé tel quel par Railway (build Dockerfile). docker-compose.yaml
# surcharge `command:` pour le développement local (runserver + reload) et
# n'est donc pas affecté par ce CMD.
CMD ["sh", "-c", "python backend/manage.py migrate --noinput && python backend/manage.py collectstatic --noinput && gunicorn config.wsgi:application --pythonpath backend --chdir backend --bind 0.0.0.0:${PORT:-8000} --workers 3"]
