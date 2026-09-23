# Swyft API Authentication Flow

This document describes how Swyft authenticates a Stellar wallet and issues a
session JWT. The server is the source of truth for nonce issuance, signature
verification, and session authorization.

## Overview

Swyft uses a **Freighter-based wallet authentication** flow with **nonce
verification** to enable stateless, replay-attack-resistant login without
storing user credentials.

1. Client requests a nonce for a wallet address.
2. Server issues a nonce, stores it with a short TTL, and returns it.
3. Client signs the nonce with the wallet key and submits the signature.
4. Server verifies the signature and **atomically consumes** the nonce.
5. Server issues a session JWT bound to the wallet address.

## Architecture

```
User                    Freighter Wallet            Swyft API
  │                           │                          │
  ├──────────────────────────►│ Request to sign nonce    │
  │                           │                          │
  │◄──────────────────────────┤ (User approves)          │
  │                           │                          │
  ├─────────────── GET /nonce ────────────────────────────►
  │                           │                          │
  │◄──────────────────────────────── Nonce (ttl: 120s) ──┤
  │                           │                          │
  │ Sign nonce with private   │                          │
  │ key via Freighter         │                          │
  │◄──────────────────────────┤                          │
  │      Signature (base64)   │                          │
  │                           │                          │
  ├──── POST /verify ────────────────────────────────────►
  │  {                        │                          │
  │    walletAddress,         │                          │
  │    nonce,                 │                          │
  │    signature               │                          │
  │  }                        │                          │
  │                           │                          │
  │◄──────────────────────────────── JWT (ttl: 15m) ─────┤
  │                           │                          │
  ├────── GET /pools ────────────────────────────────────►
  │ Authorization: Bearer JWT │                          │
  │                           │                          │
  │◄──────────────────────────────── Pool data ──────────┤
```

## Nonce lifecycle (single-use)

A nonce is valid for exactly one successful verification. The consume step is
atomic: the nonce is removed (or marked used) in the same operation that
validates it, so a nonce can never be verified twice.

Invariants:

- A nonce is bound to the wallet address that requested it.
- A nonce is single-use: consumed on the first successful signature check.
- A nonce expires after its TTL and is rejected once expired.
- Replay or concurrent reuse of a consumed nonce is rejected.
- Unknown nonces are rejected (deny-by-default).

### Atomic consume

The nonce store must expose a compare-and-delete (or equivalent atomic
consume) primitive. Verification MUST NOT be implemented as a read followed by
a separate delete, because two concurrent requests could both read the same
nonce before either deletes it.

```
consume(nonce, wallet) -> OK | UNKNOWN | EXPIRED | ALREADY_USED
```

Only `OK` permits signature verification to proceed. Any other result fails
the request.

## Step-by-Step Flow

### 1. Request Nonce

**Endpoint:** `POST /v1/auth/nonce`

**Request:**
```bash
curl -X POST https://api.example.com/v1/auth/nonce \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "GAI7Z4Z4Z2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F"}'
```

**Response:** (200 OK)
```json
{
  "nonce": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "message": "Sign this nonce to prove you own this wallet"
}
```

**What happens:**
1. API generates a random 24-byte nonce
2. Nonce is stored in Redis with key `auth:nonce:{walletAddress}`
3. Redis key expires in 120 seconds (TTL)
4. Nonce is returned to client in base64 encoding

**Error responses:**
- `400 Bad Request`: Invalid wallet address format
- `500 Internal Server Error`: Redis unavailable

### 2. Sign Nonce with Freighter

**In Freighter:**

```javascript
// Using @stellar/stellar-sdk
const nonce = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";

// Freighter handles the signing
const result = await freighterApi.signMessage({
  message: nonce,
});
// result.signature = "base64-encoded Ed25519 signature"
```

**What happens:**
1. User confirms the action in Freighter (browser extension)
2. Freighter signs the nonce string using the wallet's private key
3. Signature is Ed25519, 64 bytes, base64-encoded
4. Returned to client as `signature` field

### 3. Verify Signature and Get JWT

**Endpoint:** `POST /v1/auth/verify`

**Request:**
```bash
curl -X POST https://api.example.com/v1/auth/verify \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "GAI7Z4Z4Z2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F",
    "nonce": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "signature": "base64-encoded-signature-64-bytes"
  }'
```

**Response:** (200 OK)
```json
{
  "accessToken": "eyJhbGciOiJFZDI1NTE5IiwidHlwIjoiSldUIn0.eyJzdWIiOiJHQUk3WjRaND...",
  "expiresIn": "15m"
}
```

**Verification process (internal):**

```
1. Atomically consume the nonce from the store (compare-and-delete)
   Result must be OK; UNKNOWN/EXPIRED/ALREADY_USED → 401 Unauthorized

2. Verify Ed25519 signature using wallet public key
   If invalid → 401 Unauthorized ("Signature is invalid")

3. Sign JWT with wallet address as subject
   Payload: { sub: walletAddress, walletAddress, iat, exp }
   Algorithm: HS256 (configurable via JWT_SECRET)
   TTL: 15 minutes (configurable via JWT_EXPIRES_IN)

4. Return JWT to client
```

**Error responses:**
- `400 Bad Request`: Malformed wallet address
- `401 Unauthorized`: Nonce unknown, expired, already used, or invalid signature
- `500 Internal Server Error`: Redis unavailable (fail closed)

### 4. Use JWT for Authenticated Requests

**All subsequent API requests:**

```bash
curl -X GET https://api.example.com/v1/pools \
  -H "Authorization: Bearer eyJhbGciOiJFZDI1NTE5IiwidHlwIjoiSldUIn0.eyJzdWIiOiJHQUk3WjRaND..."
```

**In protected endpoints:**

The `JwtAuthGuard` validates the JWT:

```typescript
1. Extract token from "Bearer " header
2. Verify signature using JWT_SECRET
3. Check expiry (exp claim)
4. Extract walletAddress from token payload
5. Attach user object to request: req.user = { walletAddress }
6. Proceed to handler
```

**Error responses:**
- `401 Unauthorized`: Missing token, invalid signature, or expired token

---

## Security Guarantees

### 1. Single-Use Nonces (Replay Prevention)

**Problem:** If an attacker captures a nonce+signature pair, they could reuse it multiple times.

**Solution:** The nonce is atomically consumed (compare-and-delete) in the same
operation that validates it, so it can never be verified twice.

```typescript
// AuthService.verifyWallet()
const result = await this.nonceStore.consume(nonce, walletAddress);
if (result !== 'OK') throw new UnauthorizedException(result);
```

**Result:**
- First verification: Succeeds, nonce is consumed
- Second verification (replay): Fails with 401 `NONCE_ALREADY_USED`

### 2. Nonce Expiration (Time Window Limit)

**Problem:** A captured nonce could be used to brute-force signatures.

**Solution:** Nonces expire in the store after 120 seconds.

```typescript
// NonceController.getOrCreateNonce()
await this.nonceStore.set(redisKey, nonce, 'EX', 120);
```

**Result:**
- User must complete authentication within 120 seconds
- After 120 seconds, the store automatically deletes the nonce
- Attacker's window to exploit a captured nonce is limited

### 3. Signature Verification (Proof of Key Ownership)

**Problem:** Anyone could submit anyone else's wallet address and get a token.

**Solution:** Must sign the nonce with the wallet's private key.

```typescript
// AuthService.assertSignatureValid()
const isValid = keypair.verify(messageBytes, signatureBytes);
```

**Result:**
- Only person with the private key can sign a nonce
- Ed25519 signatures are cryptographically unforgeable
- Brute-forcing a 64-byte signature is computationally infeasible

### 4. Stateless Architecture

**Benefit:** No session storage needed.

- No database lookup for session state (fast, scalable)
- JWT itself contains all needed info (subject: wallet address)
- Horizontally scalable (any server can verify any JWT)

---

## Fail-closed behavior

If the nonce store (Redis/DB) is unavailable, the server MUST reject the
verification request. It MUST NOT fall back to an in-memory cache, skip the
nonce check, or issue a session. Auth writes fail closed.

- Store timeout or connection error -> reject with `NONCE_STORE_UNAVAILABLE`.
- Partial/ambiguous store response -> reject (treat as unavailable).
- Never log the nonce value, signature, or any secret material.

## Authorization

- The server validates the wallet address format and verifies the signature
  server-side; client-supplied identity claims are never trusted.
- The issued JWT is bound to the verified wallet address.
- Privileged surfaces are deny-by-default: a request without a valid,
  unexpired session is rejected before any policy check.
- Untrusted clients cannot bypass the nonce policy by omitting, reusing, or
  forging nonce fields.

## Error codes

Verification returns stable, typed error codes so clients and ops can react
consistently. Responses include a correlation id for tracing.

| Code | Meaning |
| --- | --- |
| `NONCE_UNKNOWN` | Nonce was never issued or has been evicted. |
| `NONCE_EXPIRED` | Nonce TTL elapsed before verification. |
| `NONCE_ALREADY_USED` | Nonce was already consumed (replay/concurrent reuse). |
| `NONCE_STORE_UNAVAILABLE` | Nonce store unreachable; request failed closed. |
| `SIGNATURE_INVALID` | Signature did not verify against the wallet. |
| `WALLET_INVALID` | Wallet address failed server-side validation. |

## Observability

- Emit counters for each error code above (no secret values in labels).
- Emit a counter for successful verifications on the money path.
- Log correlation ids, never nonces, signatures, or tokens.

## Edge cases

- **Concurrent requests:** atomic consume guarantees only one succeeds; the
  loser receives `NONCE_ALREADY_USED`.
- **Replay:** a consumed nonce is rejected on every subsequent attempt.
- **Store outage:** verification fails closed with `NONCE_STORE_UNAVAILABLE`.
- **Expired session / wrong role:** rejected by the JWT guard before policy.
- **Adversarial input:** malformed addresses/signatures are rejected without
  touching the nonce store beyond the consume attempt.
- **Testnet vs mainnet:** nonce keys are namespaced per network to avoid
  cross-network address drift.

---

## Implementation Details

### Relevant Files

| File | Purpose |
|------|---------|
| `auth/nonce.controller.ts` | Generate nonces (POST /auth/nonce) |
| `auth/auth.service.ts` | Verify signatures + issue JWTs |
| `auth/auth.controller.ts` | HTTP routes for auth endpoints |
| `auth/jwt-auth.guard.ts` | Guard for protected endpoints |
| `auth/current-wallet.decorator.ts` | Extract wallet from JWT in handlers |

### Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `NONCE_TTL` | 120 seconds | Nonce expiry in the store |
| `JWT_EXPIRES_IN` | 15 minutes | JWT token lifetime (configurable) |
| `NONCE_PREFIX` | `auth:nonce:` | Store key prefix for nonces |
| `LEDGER_PRECISION` | 32 bytes | Minimum nonce randomness |

### Environment Variables

```bash
# JWT configuration
JWT_SECRET=your-secret-key-here        # REQUIRED for signature verification
JWT_EXPIRES_IN=15m                    # Default: 15 minutes
JWT_ISSUER=swyft-api                  # Optional: iss claim
JWT_AUDIENCE=swyft-client             # Optional: aud claim

# Redis (for nonce storage)
REDIS_URL=redis://localhost:6379      # Default: localhost:6379
REDIS_PASSWORD=...                    # Optional TLS/auth
```

---

## Testing the Flow

### End-to-End Test

```bash
#!/bin/bash

API_URL="https://api.example.com/v1"
WALLET="GAI7Z4Z4Z2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F2IXPJ7F"

# Step 1: Request nonce
NONCE_RESPONSE=$(curl -s -X POST $API_URL/auth/nonce \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\": \"$WALLET\"}")

NONCE=$(echo $NONCE_RESPONSE | jq -r '.nonce')
echo "Received nonce: $NONCE"

# Step 2: Sign nonce with Freighter (done in browser/extension)
# SIGNATURE="<base64-signature>"

# Step 3: Verify signature and get JWT
JWT_RESPONSE=$(curl -s -X POST $API_URL/auth/verify \
  -H "Content-Type: application/json" \
  -d "{
    \"walletAddress\": \"$WALLET\",
    \"nonce\": \"$NONCE\",
    \"signature\": \"$SIGNATURE\"
  }")

JWT=$(echo $JWT_RESPONSE | jq -r '.accessToken')
echo "Received JWT: $JWT"

# Step 4: Use JWT in authenticated request
curl -s -X GET $API_URL/pools \
  -H "Authorization: Bearer $JWT" | jq '.'

# Step 5: Try to replay nonce (should fail)
echo "Testing replay attack (should fail):"
curl -s -X POST $API_URL/auth/verify \
  -H "Content-Type: application/json" \
  -d "{
    \"walletAddress\": \"$WALLET\",
    \"nonce\": \"$NONCE\",
    \"signature\": \"$SIGNATURE\"
  }" | jq '.error'
# Expected: NONCE_ALREADY_USED
```

### Unit Tests

See `auth/auth.service.spec.ts` and `auth/nonce-single-use.spec.ts` for
comprehensive test coverage:
- Successful verification
- Nonce expiration
- Signature validation
- Replay attack prevention
- Concurrent consume (only one winner)
- Edge cases (malformed addresses, wrong keys)

---

## Troubleshooting

### `NONCE_UNKNOWN` / "Nonce has expired or does not exist"

**Cause:** One of:
1. Nonce was already used (single-use enforcement)
2. 120+ seconds passed since nonce was generated
3. Nonce store connection lost, nonce not stored

**Solution:**
- Request a fresh nonce
- Verify the nonce store is running
- Check JWT TTL hasn't expired

### `NONCE_ALREADY_USED`

**Cause:** The nonce was already consumed (replay or concurrent reuse).

**Solution:**
- Request a fresh nonce and retry
- Ensure only one verification request is in flight per nonce

### `SIGNATURE_INVALID`

**Cause:** One of:
1. Signature was signed with wrong key
2. Signature is malformed (not 64 bytes base64)
3. Wallet address doesn't match the signing key

**Solution:**
- Verify wallet address matches Freighter's active account
- Ensure Freighter actually signed the nonce
- Check signature hasn't been corrupted

### `NONCE_STORE_UNAVAILABLE`

**Cause:** The nonce store (Redis/DB) is unreachable or returned an ambiguous
response.

**Solution:**
- Check store connectivity and credentials
- Auth fails closed by design; retry once the store recovers

---

## Rollback / kill-switch

Any change to the nonce or verification path lands behind a feature flag.
Disabling the flag restores the previous behavior without a deploy. Rollback
steps are documented in the PR description.

---

## Related Issues

- **#552:** Sentry scrubbing for wallet addresses (prevent PII leakage)
- **#555:** Auth nonce single-use enforcement (this flow)

---

## References

- `apps/api/src/auth/nonce-single-use.spec.ts`
- [Freighter Docs](https://freighter.app/)
- [Stellar SDK Docs](https://stellar.org/developers)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8949)
- [Replay Attack Prevention](https://owasp.org/www-community/attacks/Replay_attack)
