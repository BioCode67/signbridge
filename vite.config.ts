import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' is REQUIRED for Capacitor — the native shell loads index.html over
// file://, so absolute asset paths (/assets/...) would 404 and show a blank screen.
export default defineConfig({
  base: './',
  plugins: [react()],
})
