# GCP Cloud Run Deployment Guide

## Prerequisites
1. Go to https://console.cloud.google.com/
2. Select or create a project (e.g., "tmai-dashboard")
3. Enable billing
4. Enable these APIs:
   - Cloud Run API
   - Artifact Registry API

## Step 1: Create Artifact Registry
1. Go to **Artifact Registry** → **Repositories**
2. Click **Create Repository**
   - Name: `tmai-docker`
   - Format: **Docker**
   - Region: `europe-west2` (London) — or pick your region
   - Click **Create**

## Step 2: Import the Docker Image
Option A — Upload from terminal (if you have gcloud):
```
gcloud auth configure-docker EUROPE-WEST2-DOCKER.pkg.dev --quiet
docker load -i tmai-dashboard.tar
docker tag tmai-dashboard:latest EUROPE-WEST2-DOCKER.pkg.dev/YOUR_PROJECT/tmai-docker/tmai-dashboard:latest
docker push EUROPE-WEST2-DOCKER.pkg.dev/YOUR_PROJECT/tmai-docker/tmai-dashboard:latest
```

Option B — Build & push directly in Cloud Build:
1. Go to **Cloud Build** → **Triggers**
2. Or use the Docker image we built locally (tmai-dashboard.tar)

## Step 3: Create Cloud Run Service
1. Go to **Cloud Run** → **Create Service**
2. **Deploy one revision from the following container image**:
   - `europe-west2-docker.pkg.dev/YOUR_PROJECT/tmai-docker/tmai-dashboard:latest`
3. **Service name**: `tmai-dashboard`
4. **Authentication**: Allow unauthenticated (we handle auth in the app) or set to Authenticated
5. **Container settings**:
   - Memory: 512 MiB
   - CPU: 1
   - Container port: 8080
   - Max instances: 5
   - **Timeout**: 600 seconds (10 minutes!)
6. **Environment variables** (add all of these):

| Variable | Value |
|---|---|
| `LLM_API_KEY` | Your Gemini API key |
| `GADS_DEV_TOKEN` | Google Ads developer token |
| `GADS_REFRESH_TOKEN` | Google Ads refresh token |
| `GADS_CLIENT_ID` | Google Ads OAuth client ID |
| `GADS_CLIENT_SECRET` | Google Ads OAuth client secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (434324143090-...) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

7. **Networking**:
   - Ingress: All traffic
   - Click **Create**

## Step 4: Get the URL
After deployment, Cloud Run gives you a URL like:
```
https://tmai-dashboard-abc123.europe-west2.run.app
```

## Step 5: Set up Custom Domain (optional)
1. Go to **Cloud Run** → `tmai-dashboard` → **Domains**
2. Add `tmicollective.com` (or subdomain like `tools.tmicollective.com`)
3. Set up DNS CNAME (GCP will give you the target)

## Environment Variables Reference
All the same env vars as Netlify, set in Cloud Run service config:
- `LLM_API_KEY` — Gemini API key
- `GADS_DEV_TOKEN` — Google Ads developer token
- `GADS_REFRESH_TOKEN` — OAuth refresh token for Google Ads
- `GADS_CLIENT_ID` / `GADS_CLIENT_SECRET` — Google Ads OAuth client credentials
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — User auth OAuth client credentials

## Updating the Service
1. Rebuild Docker image locally: `docker build -t tmai-dashboard:latest .`
2. Tag and push to Artifact Registry
3. Go to Cloud Run → tmai-dashboard → **Edit** → update container image
4. Or use Cloud Build triggers for automatic deployment from git