import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  loadEnv(mode, '.', '')
  return {
    server: {
      host: '0.0.0.0',
      port: 3100,
      proxy: {
        '/local-api': {
          target: 'http://127.0.0.1:3101',
          changeOrigin: false,
        },
      },
    },
  }
})
