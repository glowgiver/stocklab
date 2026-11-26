import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' → läuft auf GitHub Pages unter /<repo>/ ebenso wie lokal.
export default defineConfig({
  base: './',
  // node_modules ist ein Symlink auf node_modules.nosync (damit iCloud ihn nicht synchronisiert)
  resolve: { preserveSymlinks: true },
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: { port: 5173, host: '127.0.0.1' },
})
