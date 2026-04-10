# Vercel Backend

This folder is the Vercel deployment root for the production backend.

## What it supports

- Instagram extraction and download endpoints
- Proxying Instagram media URLs
- Health checks for the mobile app

## Deploy on Vercel

1. Create a new Vercel project from this repository.
2. Set the root directory to `InstaSave/vercel`.
3. Deploy with the default settings.

## App configuration

Point the mobile app backend URL to the deployed Vercel project root, for example:

- `https://your-project.vercel.app`

The app uses these routes through rewrites:

- `/health`
- `/extract`
- `/download`
- `/proxy`

The app checks `/health` and runs in Instagram-only mode.
