import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const legacyTarget = env.VITE_DEV_BACKEND_ORIGIN || 'http://127.0.0.1:8000'
  const chatTarget = env.VITE_DEV_CHAT_BACKEND_ORIGIN || legacyTarget
  const wikiTarget = env.VITE_DEV_WIKI_BACKEND_ORIGIN || legacyTarget

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/chat': {
          target: chatTarget,
          changeOrigin: true,
        },
        '/wiki/api': {
          target: wikiTarget,
          changeOrigin: true,
        },
        '/references': {
          target: wikiTarget,
          changeOrigin: true,
        },
        '/dbServ': {
          target: 'https://aiapp.pangomicro.com',
          changeOrigin: true,
          secure: false,
        },
        '/api/ragflow': {
          target: chatTarget,
          changeOrigin: true,
        },
        '/api': {
          target: 'https://aiapp.pangomicro.com',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
