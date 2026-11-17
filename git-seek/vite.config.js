import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// In development the browser only talks to Vite; API and auth requests are
// proxied to the Express server so cookies stay first-party.
const backend = 'http://localhost:5000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/auth': backend
    }
  }
})
