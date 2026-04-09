# Mediqra Production Backend

This backend replaces the local PC proxy for production use.

## Features
- Instagram extraction and media proxy endpoints:
  - `/extract`
  - `/download`
  - `/proxy`
- YouTube extraction and download endpoints:
  - `/youtube/extract`
  - `/youtube/download`
- Health endpoint: `/health`

## Local run
1. `cd InstaSave/backend`
2. `npm install`
3. `npm start`
4. Open `http://localhost:8787/health`

## Deploy to Render
1. Push this repo to GitHub.
2. In Render, create a new Web Service.
3. Select `InstaSave/backend/render.yaml` blueprint or set:
- Root directory: `InstaSave/backend`
- Environment: Docker
- Health check path: `/health`
4. Deploy and copy the generated HTTPS URL, for example:
- `https://mediqra-backend.onrender.com`

## Deploy to Railway
1. Create a new Railway project from your GitHub repo.
2. Railway will use `InstaSave/backend/railway.json` and Dockerfile.
3. Deploy and copy the generated HTTPS URL.

## Connect app to backend
In the app:
1. Open Download tab.
2. Paste backend URL in `Production backend API URL`.
3. Tap `Save backend URL`.
4. Then run Instagram/YouTube downloads.

## Notes
- The backend must stay online for YouTube and reliable Instagram downloads.
- Use HTTPS URL in production.
