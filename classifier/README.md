Retraining the email classifier
================================

This repository includes a small classifier service in `classifier/` which can be retrained to produce a new `models/email_models.joblib` artifact. The running `classifier` service (when started via docker-compose) mounts the host `./models` directory into the container, so placing the artifact at `models/email_models.joblib` on the host will make it available to the service.

Prerequisites
- A `DATABASE_URL` pointing to a Postgres database containing labeled messages (the training script expects `messages` joined with `ai_metadata` labels when using `--db`). See `.env.example` for examples.
- Sufficient CPU and memory; training may take several minutes.

Options to retrain

1) Using Docker Compose (recommended):

```bash
# runs the training script inside the classifier service image and writes the artifact to ./models
docker compose --env-file .env run --rm classifier sh -c 'python train_classifier.py --db "$DATABASE_URL" --out /app/models/email_models.joblib'
```

Notes:
- Docker Compose will use environment variables from your `.env` (if present), so `DATABASE_URL` should be available to the container.
- The script writes to `/app/models/email_models.joblib` inside the container; since `./models` is mounted into `/app/models`, the host path `./models/email_models.joblib` will contain the trained model after the command completes.

2) Locally (virtualenv):

```bash
# from repository root
python -m venv .venv
. .venv/bin/activate
pip install -r classifier/requirements.txt
python classifier/train_classifier.py --db "$DATABASE_URL" --out models/email_models.joblib
```

Notes:
- Ensure you have the packages in `classifier/requirements.txt` installed (XGBoost and sentence-transformers are required).
- The `--csv` option is also available if you prefer to train from a CSV file instead of `--db`.

After training
- Verify `models/email_models.joblib` exists on the host.
- The running `classifier` service should pick up the new model on startup; if it was already running, restart the `classifier` container to reload the model:

```bash
docker compose restart classifier
```

Troubleshooting
- If XGBoost fails to install on your platform, consider using the Docker approach (the classifier image installs dependencies inside the container).
- Training logs and metric outputs are printed to stdout by the training script.

Optional: Use an LLM to infer missing categories at training time
----------------------------------------------------------------

If some messages in your training set are missing a user-defined category but you still want to include them in training, the training script can optionally call an LLM to infer a category for those rows at training time only. The inferred labels are used in-memory for the training run and are NOT written back to your database.

Usage example (requires an OpenAI API key set in `OPENAI_API_KEY`):

```bash
python classifier/train_classifier.py --db "$DATABASE_URL" --out models/email_models.joblib --use-llm --llm-model gpt-3.5-turbo
```

You can provide the LLM base URL (for OpenAI-compatible proxies) or an Ollama URL via `--llm-base` or by setting `OPENAI_API_BASE` / `OLLAMA_URL` in your environment. The script will also pick up `OPENAI_MODEL` as the default model name.


You can also explicitly provide the allowed categories (comma-separated) to constrain the LLM mapping:

```bash
python classifier/train_classifier.py --db "$DATABASE_URL" --out models/email_models.joblib --use-llm --categories "primary,updates,social,newsletters,promotions,other"
```

Notes:
- The script looks for `OPENAI_API_KEY` in the environment if `--openai-key` is not supplied.
- LLM inference is best-effort and intended only to increase coverage during training; it will not modify any persistent labels in your database.
 - By default LLM-inferred categories are now persisted back to the database (`ai_metadata`) when training from a database via `--db`. The trainer will update existing `ai_metadata` (version=1) `labels.category` or insert a new `ai_metadata` row if none exists. If you prefer not to persist inferred labels, omit `--use-llm` or run training from CSV.
