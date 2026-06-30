export function getCorsOrigins(): string[] {
  const raw =
    process.env.WEB_APP_ORIGIN ??
    process.env.CORS_ORIGIN ??
    'http://localhost:3000';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
