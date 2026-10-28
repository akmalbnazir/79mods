FROM python:3.12-slim

WORKDIR /app
COPY app.py .

ENV PORT=8080
ENV DATABASE_PATH=/data/offers.sqlite3
EXPOSE 8080

CMD ["python", "app.py"]
