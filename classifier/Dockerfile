FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY ./requirements.txt /app/requirements.txt
RUN apt-get update && apt-get install -y build-essential git && \
    pip install --upgrade pip && pip install -r /app/requirements.txt && \
    apt-get remove -y build-essential && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . /app
EXPOSE 8000
CMD ["uvicorn", "infer_service:app", "--host", "0.0.0.0", "--port", "8000"]
