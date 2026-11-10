import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { adminSessionDevelopmentServer } from './admin-session-proxy.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: adminSessionDevelopmentServer,
  
})
