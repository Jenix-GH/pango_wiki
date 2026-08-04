import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    server: {
      port: 3100,
      proxy: {
        '/dbServ': {
          target: env.ADMIN_BACKEND_ORIGIN || 'https://aiapp.pangomicro.com',
          changeOrigin: true,
          secure: false,
          ...(env.ADMIN_BACKEND_ORIGIN
            ? { rewrite: (path) => path.replace(/^\/dbServ/, '') }
            : {}),
        },
      },
    },
  }
})
