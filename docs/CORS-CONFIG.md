# CORS Configuration Guide

## Overview

Swyft API uses CORS (Cross-Origin Resource Sharing) to control which origins can make browser requests to the API. Configuration differs between development and production environments.

## Environment Variables

### `WEB_APP_ORIGIN` (Primary)

Comma-separated list of allowed origins. Used in both dev and production.

**Example:**
```bash
WEB_APP_ORIGIN="https://app.swyft.example,https://www.swyft.example"
```

### `CORS_ORIGIN` (Fallback)

Fallback if `WEB_APP_ORIGIN` not set. Same format as `WEB_APP_ORIGIN`.

```bash
CORS_ORIGIN="https://app.example.com"
```

**Priority:** `WEB_APP_ORIGIN` > `CORS_ORIGIN` > (dev default: `http://localhost:3000`)

---

## Development Mode (`NODE_ENV=development`)

**Behavior:**
- If neither `WEB_APP_ORIGIN` nor `CORS_ORIGIN` is set, defaults to `http://localhost:3000`
- Allows local web app to make requests without explicit config
- Simplifies local testing

**Example:**
```bash
# No env vars needed — defaults to http://localhost:3000
npm run dev
```

Or with explicit origins:
```bash
export WEB_APP_ORIGIN="http://localhost:3000,http://localhost:5173"
npm run dev
```

---

## Production Mode (`NODE_ENV=production`)

**Behavior:**
- **Rejects** any requests from origins not in the allowlist
- **Requires** explicit `WEB_APP_ORIGIN` or `CORS_ORIGIN` — no fallback to localhost
- **Blocks** localhost and 127.0.0.1 even if explicitly configured
- Fails fast at startup if config is missing

**Error if misconfigured:**
```
Production CORS: WEB_APP_ORIGIN or CORS_ORIGIN must be set. 
No fallback to localhost allowed in production.
```

**Correct production setup:**
```bash
export NODE_ENV="production"
export WEB_APP_ORIGIN="https://app.swyft.example,https://www.swyft.example"
node dist/main.js
```

---

## How CORS Works

When a browser makes a request from **Origin A** to the API (Origin B):

1. Browser sends `Origin: https://origina.example` header
2. API checks if origin is in allowlist
   - **If allowed:** Responds with `Access-Control-Allow-Origin: https://origina.example` → browser allows response
   - **If rejected:** No `Access-Control-Allow-Origin` header → browser blocks response (CORS error)

**Example CORS error in browser console:**
```
Access to XMLHttpRequest at 'https://api.example.com/v1/pools' 
from origin 'https://unknown.example.com' has been blocked by CORS policy: 
The value of the 'Access-Control-Allow-Origin' header in the response 
must not be the wildcard '*' when the request's credentials mode (include) is 'include'.
```

---

## Deployment Checklist

### Before deploying to production:

- [ ] Set `NODE_ENV=production`
- [ ] Set `WEB_APP_ORIGIN` to your production web domains (comma-separated, no spaces after commas)
  - Example: `https://swyft.io,https://www.swyft.io,https://app.swyft.io`
- [ ] Do **NOT** include localhost, 127.0.0.1, or HTTP (use HTTPS only)
- [ ] Test CORS before going live:
  ```bash
  # From your production web domain, open browser console and run:
  fetch('https://api.example.com/v1/pools', { credentials: 'include' })
  ```
  Should succeed. If you see CORS error, check that your domain is in `WEB_APP_ORIGIN`.

---

## Troubleshooting

### CORS error in browser console

**Problem:** Requests from your web app are blocked.

**Solution:**
1. Check the origin in the error message (e.g., `https://app.example.com`)
2. Verify it's in `WEB_APP_ORIGIN`:
   ```bash
   echo $WEB_APP_ORIGIN
   # Expected: https://api.example.com,https://app.example.com,...
   ```
3. If missing, add it: `export WEB_APP_ORIGIN="https://app.example.com,https://www.example.com"`
4. Restart the API

### Startup error: "Production CORS must be set"

**Problem:** API refuses to start in production without CORS config.

**Solution:**
```bash
# Set the env var BEFORE starting the app
export NODE_ENV="production"
export WEB_APP_ORIGIN="https://swyft.io"
node dist/main.js
```

### Startup error: "localhost not allowed in production"

**Problem:** You accidentally included `http://localhost:3000` in production config.

**Solution:**
Remove localhost/127.0.0.1 from `WEB_APP_ORIGIN`:
```bash
# BAD (won't start)
export WEB_APP_ORIGIN="https://app.example.com,http://localhost:3000"

# GOOD (will start)
export WEB_APP_ORIGIN="https://app.example.com"
```

---

## Testing CORS Configuration

### Unit tests
```bash
pnpm test -- cors.spec.ts
```

### Manual test (curl)
```bash
# Request WITH origin header (simulates browser)
curl -i -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: GET" \
  https://api.example.com/v1/pools

# Check response for:
# - "Access-Control-Allow-Origin: https://app.example.com" → allowed
# - No "Access-Control-Allow-Origin" → blocked
```

### Browser console test
```javascript
// From browser console on your web domain
fetch('https://api.example.com/v1/pools', { credentials: 'include' })
  .then(r => r.json())
  .then(d => console.log('CORS OK:', d))
  .catch(e => console.error('CORS ERROR:', e))
```

---

## Related Files

- **Main implementation:** `apps/api/src/cors.ts`
- **Bootstrap:** `apps/api/src/main.ts` (calls `validateCorsConfig()`)
- **Tests:** `apps/api/src/cors.spec.ts`
- **Issue:** #551

---

## Security Notes

- CORS only affects **browser requests** (XHR, fetch, `<script src>`, etc.)
- Non-browser clients (curl, Postman, mobile apps, backend services) are **NOT blocked by CORS**
- To fully protect your API, combine CORS with:
  - Rate limiting
  - API key validation
  - OAuth/JWT authentication
  - WAF (Web Application Firewall) rules

---

*Last updated: 2026-07-26*
