# Sentry Redaction Policy

## Overview

The Swyft API implements a strict PII (Personally Identifiable Information) redaction policy in Sentry to prevent accidental exposure of sensitive wallet and authentication data to error reporting.

## What Is Redacted

The `beforeSend` hook in `sentry.ts` redacts the following types of sensitive data before events are sent to Sentry:

### Automatic Pattern Matching
- **Wallet Addresses**: Stellar addresses (56 base32 chars starting with 'G')
  - Pattern: `\bG[A-Z2-7]{55}\b`
  - Example: `GAI7Z4Z4Z2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F` → `[REDACTED]`

- **Nonce Values**: Authentication nonces (32+ hex or base64 chars)
  - Pattern: `nonce["\s:=]*:?["\s]?([a-f0-9]{32,}|[a-zA-Z0-9+/]{40,})/gi`
  - Example: `nonce: "a1b2c3d4..."` → `nonce: [REDACTED]`

- **Tokens & Secrets**: Keys matching 'token', 'signature', 'secret', 'password', 'accessToken', 'refreshToken'
  - Applied recursively to all object keys and string values

### Redaction Scope

The hook redacts sensitive data from:
- **Breadcrumbs**: Message text and data
- **Contexts**: Request context, user context
- **Extra fields**: Additional context data
- **Request details**: Headers, body, URL parameters
- **Exception messages**: Error message text
- **Stack traces**: Values in exception context

## What Is Kept

The following information is retained for debugging:
- **Request metadata**: HTTP method, path, status code, timing
- **Error types**: Exception class names and stack traces (with sensitive values redacted)
- **Tags**: `requestId`, `path`, `method` (if set via `setRequestContext()`)
- **User context**: Wallet address as `user.id` (hashed or tagged, not in messages)
- **Timestamps and IDs**: For correlation with application logs

## Implementation

### Core Scrubber Function

Located in `apps/api/src/sentry.ts`:

```typescript
function redactSensitiveData(value: unknown, depth = 0): unknown
```

- **Recursive**: Traverses nested objects and arrays
- **Type-aware**: Handles strings, objects, arrays, primitives
- **Depth-limited**: Prevents infinite recursion (max depth 50)
- **Safe**: Returns original value if type is not supported

### beforeSend Hook

Called by Sentry SDK before every event is sent:
- Runs on all breadcrumbs, contexts, exceptions, requests
- Replaces matched patterns with `[REDACTED]` string
- Preserves event structure for debugging

## Usage

### Setting Wallet Context (Optional)

To tag a request with wallet information in Sentry:

```typescript
import { setRequestContext } from './sentry';

// In an error handler or middleware
setRequestContext(requestId, path, method, walletAddress);
```

This adds safe tags to the Sentry scope. The wallet address will:
1. Be tagged in Sentry as a user ID
2. Be redacted from any error messages or breadcrumbs per the beforeSend hook

### Example: Redacted Event

**Before redaction (hypothetical sensitive data):**
```json
{
  "message": "Auth failed",
  "contexts": {
    "wallet": "GAI7Z4Z4Z2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F",
    "nonce": "a1b2c3d4e5f6..."
  },
  "request": {
    "headers": {
      "authorization": "Bearer token_xyz"
    },
    "body": {
      "walletAddress": "GAI7Z4Z4Z2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F",
      "signature": "signature_value_here"
    }
  }
}
```

**After redaction:**
```json
{
  "message": "Auth failed",
  "contexts": {
    "wallet": "[REDACTED]",
    "nonce": "[REDACTED]"
  },
  "request": {
    "headers": {
      "authorization": "[REDACTED]"
    },
    "body": {
      "walletAddress": "[REDACTED]",
      "signature": "[REDACTED]"
    }
  }
}
```

## Testing

Sensitive data redaction is tested via:
1. Unit tests in `auth/auth.service.spec.ts` (for nonce single-use)
2. Manual Sentry event inspection (sample events should be scrubbed)

To verify manually:
1. Trigger an error with a wallet address in the context
2. Check the event in Sentry dashboard
3. Confirm all wallet addresses and nonces show as `[REDACTED]`

## Configuration

Controlled by environment variables:
- `SENTRY_DSN` - Enable/disable Sentry (if not set, disabled)
- `NODE_ENV` - Redaction applies in all environments except 'test'
- `SENTRY_TRACES_SAMPLE_RATE` - Trace sampling rate (default 0.1)

## Related Files

- `src/sentry.ts` - Core Sentry initialization and redaction logic
- `src/logging/logging.middleware.ts` - Request/response logging (also redacts sensitive data)
- `src/request-validation/all-exceptions.filter.ts` - Global exception handler
