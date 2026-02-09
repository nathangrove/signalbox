# NotJAEC Frontend (dev)

This is a minimal Vite + React TypeScript frontend scaffold.

Run locally:

```bash
cd web
npm install
npm run dev
```

The frontend expects the API server at `http://localhost:3000/v1` (configure proxy later).

You can configure the API base via environment variable `VITE_API_BASE`.

Example `.env` for frontend:

```
VITE_API_BASE=http://localhost:3000/v1
```
