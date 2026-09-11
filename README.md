# Haji Auto Parts

Standalone Node.js storefront and order-management backend.

## Run locally

Requires Node.js 22.5+.

```bash
npm start
```

Open `http://localhost:3000`.

## Deploy on Render

This project is configured for Render with `render.yaml`.

Set these environment variables in Render:

- `ADMIN1_PHONE`
- `ADMIN1_PASSWORD`
- `ADMIN2_PHONE` (optional)
- `ADMIN2_PASSWORD` (optional)

The app listens on `0.0.0.0` and uses Render's `PORT` automatically.

### Important: demo database

Orders are stored in a local SQLite database under `data/haji.sqlite`. The `data/` directory is intentionally ignored by Git. On a free ephemeral host, local files should be treated as temporary demo data. For production, move orders/inventory to a persistent managed database and use durable storage where appropriate.
