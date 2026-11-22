const configuredApiOrigin = process.env.VENUE_API_ORIGIN;

if (!configuredApiOrigin) {
  throw new Error('Set VENUE_API_ORIGIN to the public HTTPS origin of the Venue API.');
}

const api = new URL(configuredApiOrigin);
if (api.protocol !== 'https:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('VENUE_API_ORIGIN must be an HTTPS origin with no credentials, path, query, or fragment.');
}

export const config = {
  framework: 'vite',
  buildCommand: 'pnpm --filter @venue/shared build && pnpm --filter @venue/web build',
  outputDirectory: 'apps/web/dist',
  rewrites: [
    { source: '/api/:path*', destination: `${api.origin}/api/:path*` },
    { source: '/health/:path*', destination: `${api.origin}/health/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
  headers: [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            'upgrade-insecure-requests',
          ].join('; '),
        },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
    },
    {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store' }],
    },
  ],
};
