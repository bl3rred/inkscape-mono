# Inkscrape Monorepo

Single-repo submission with:
- `inkscrape-frontend` (Vercel)
- `inkscrape-backend` (Vultr)

## Structure

```txt
inkscrape-frontend/
inkscrape-backend/
package.json
README.md
```

## Workspace Commands (run from repo root)

- `npm run dev:frontend`
- `npm run dev:backend`
- `npm run start:backend`
- `npm run build:frontend`
- `npm run test:frontend`
- `npm run lint:frontend`

## Environment Variables

### Frontend (`inkscrape-frontend`) - Vercel

Required:
- `VITE_API_BASE_URL` (example: `https://inkscape-api.duckdns.org`)
- `VITE_AUTH0_DOMAIN` (example: `dev-xxxx.us.auth0.com`)
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE` (example: `https://api.inkscape`)

### Backend (`inkscrape-backend`) - Vultr

Required:
- `PORT` (example: `3001`)
- `NODE_ENV` (`production`)
- `MONGODB_URI` (real Mongo connection string)
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `DEV_AUTH` (`false` for production demo)

Optional:
- `GEMINI_API_KEY` (if not set, agreement generation uses fallback template)
- `CORS_ALLOWED_ORIGINS` (comma-separated exact origins, example: `https://yourdomain.com,https://www.yourdomain.com`)

## Critical Matching Rules

- Frontend `VITE_AUTH0_AUDIENCE` must equal backend `AUTH0_AUDIENCE`.
- Frontend `VITE_AUTH0_DOMAIN` must match backend `AUTH0_DOMAIN`.
- Frontend `VITE_API_BASE_URL` must point to your live backend URL.

## Deployment Notes

- Frontend deploys via Vercel project settings/build in `inkscrape-frontend`.
- Backend deploys on Vultr and must be reachable over HTTPS from frontend origin.
- Confirm backend health after deploy:
  - `GET /health`
  - `GET /api/v1/health`
