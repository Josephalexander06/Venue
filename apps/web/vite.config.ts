import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig(({ command }) => {
  if (command === 'build' && process.env.VERCEL === '1') {
    const origin = process.env.VENUE_API_ORIGIN;
    if (!origin?.startsWith('https://') || !URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new Error('Set VENUE_API_ORIGIN to your Render HTTPS origin without a trailing slash.');
    }
  }

  return {
    plugins: [react()],
    server: {
      port: Number(process.env.WEB_PORT ?? 5173),
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
      },
    },
  };
});
