import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import configHandler from './api/config.js';
import supabaseHandler from './api/supabase.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']) {
    if (env[name] && !process.env[name]) process.env[name] = env[name];
  }
  return {
    plugins: [react(), {
      name: 'same-origin-supabase-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = (req.url || '').split('?')[0];
          if (path === '/api/config') return configHandler(req, res);
          if (path === '/api/supabase' || path.startsWith('/api/supabase/')) return supabaseHandler(req, res);
          if (path.startsWith('/api/')) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          next();
        });
      },
    }],
    build: { sourcemap: false, target: 'es2022' },
  };
});
