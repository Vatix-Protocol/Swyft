# Price WebSocket reconnect behavior

Connect to `/price` and send `{ "action": "subscribe", "poolId": "..." }`
after every successful connection. Subscriptions are connection-scoped and
must be restored after reconnecting.

Clients should reconnect after an unexpected close with exponential backoff:
start at 1 second, double each attempt, and cap the delay at 30 seconds. Reset
the attempt counter after `open`, and cancel pending timers when the consuming
view is disposed. The web hooks implement this policy.

The server removes subscriptions on both `close` and `error`. Failed sends and
Redis subscribe/unsubscribe operations are logged and contained so a dropped
connection cannot produce an unhandled rejection.
