# Mediqra Production (Phone-Only, No PC Proxy)

Use this single path only.

## 1) Deploy backend (one time)

Deploy the backend repo on Vercel and use this URL:

```text
https://backendmediqra.vercel.app
```

Set Vercel root directory to:

```text
/
```

After deploy, verify:

```text
https://backendmediqra.vercel.app/health
```

## 2) Configure app (one time)

In app Download tab:

1. Paste `https://backendmediqra.vercel.app` in `Production backend API URL`.
2. Tap `Save backend URL`.

Use this value:

```text
https://backendmediqra.vercel.app
```

## 3) Build release APK

From workspace root:

```powershell
npm run app:build:apk:clean
```

APK path:

```text
InstaSave/android/app/build/outputs/apk/release/app-release.apk
```

## 4) Use on phone

1. Install APK.
2. Open app.
3. Paste Instagram/YouTube link.
4. Download.

No local proxy, no Railway, no Render, no VPS.

## 5) Limitation

YouTube on Vercel native mode is MP4-only (no MP3 conversion).

If YouTube shows "Sign in to confirm you're not a bot", set Vercel env var `YOUTUBE_COOKIE` and redeploy.

## 6) If /health shows 404

In Vercel Project Settings:

1. Verify the linked repo is `jaais0n/backendmediqra`.
2. Root Directory must be `/`.
3. Trigger a redeploy.
