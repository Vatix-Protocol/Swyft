# Swyft API Authentication Flow

## Overview

Swyft uses a **Freighter-based wallet authentication** flow with **nonce verification** to enable stateless, replay-attack-resistant login without storing user credentials.

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
1. GET nonce from Redis (auth:nonce:{walletAddress})
   If null → 401 Unauthorized ("Nonce has expired or does not exist")

2. Compare submitted nonce with stored nonce
   If mismatch → 401 Unauthorized ("Nonce mismatch")

3. Verify Ed25519 signature using wallet public key
   If invalid → 401 Unauthorized ("Signature is invalid")

4. DELETE nonce from Redis (SINGLE-USE ENFORCEMENT)
   This is critical: prevents nonce replay attacks

5. Sign JWT with wallet address as subject
   Payload: { sub: walletAddress, walletAddress, iat, exp }
   Algorithm: HS256 (configurable via JWT_SECRET)
   TTL: 15 minutes (configurable via JWT_EXPIRES_IN)

6. Return JWT to client
```

**Error responses:**
- `400 Bad Request`: Malformed wallet address
- `401 Unauthorized`: Nonce expired, mismatched, or invalid signature
- `500 Internal Server Error`: Redis unavailable

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

**Solution:** Nonce is deleted from Redis immediately after first successful verification.

```typescript
// AuthService.verifyWallet() line 82
await this.redis.del(redisKey);
```

**Result:**
- First verification: Succeeds, nonce is deleted
- Second verification (replay): Fails with 401 "Nonce has expired or does not exist"

### 2. Nonce Expiration (Time Window Limit)

**Problem:** A captured nonce could be used to brute-force signatures.

**Solution:** Nonces expire in Redis after 120 seconds.

```typescript
// NonceController.getOrCreateNonce() line 41
await this.redis.set(redisKey, nonce, 'EX', 120);
```

**Result:**
- User must complete authentication within 120 seconds
- After 120 seconds, Redis automatically deletes the nonce
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
| `NONCE_TTL` | 120 seconds | Nonce expiry in Redis |
| `JWT_EXPIRES_IN` | 15 minutes | JWT token lifetime (configurable) |
| `NONCE_PREFIX` | `auth:nonce:` | Redis key prefix for nonces |
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
# Expected: "Nonce has expired or does not exist"
```

### Unit Tests

See `auth/auth.service.spec.ts` for comprehensive test coverage:
- Successful verification
- Nonce expiration
- Signature validation
- Replay attack prevention
- Edge cases (malformed addresses, wrong keys)

---

## Troubleshooting

### "Nonce has expired or does not exist"

**Cause:** One of:
1. Nonce was already used (single-use enforcement)
2. 120+ seconds passed since nonce was generated
3. Redis connection lost, nonce not stored

**Solution:**
- Request a fresh nonce
- Verify Redis is running
- Check JWT TTL hasn't expired

### "Nonce mismatch"

**Cause:** Submitted nonce doesn't match the stored one.

**Solution:**
- Ensure nonce wasn't tampered with in transit
- Use HTTPS, not HTTP
- Check your client code is submitting the exact nonce

### "Signature is invalid"

**Cause:** One of:
1. Signature was signed with wrong key
2. Signature is malformed (not 64 bytes base64)
3. Wallet address doesn't match the signing key

**Solution:**
- Verify wallet address matches Freighter's active account
- Ensure Freighter actually signed the nonce
- Check signature hasn't been corrupted

---

## Related Issues

- **#552:** Sentry scrubbing for wallet addresses (prevent PII leakage)
- **#555:** Auth nonce single-use enforcement (this flow)

---

## References

- [Freighter Docs](https://freighter.app/)
- [Stellar SDK Docs](https://stellar.org/developers)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8949)
- [Replay Attack Prevention](https://owasp.org/www-community/attacks/Replay_attack)
