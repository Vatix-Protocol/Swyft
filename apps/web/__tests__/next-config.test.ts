import nextConfig from '../next.config';

describe('web security headers', () => {
  it('allows only the configured Horizon, RPC, API, and WebSocket origins', async () => {
    const [route] = await nextConfig.headers!();
    const csp = route.headers.find(
      ({ key }) => key === 'Content-Security-Policy',
    )?.value;

    expect(csp).toContain(
      "connect-src 'self' https://soroban-testnet.stellar.org https://horizon-testnet.stellar.org http://localhost:3001 ws://localhost:3001",
    );
    expect(csp).not.toContain("connect-src 'self' https: wss:");
  });
});
