import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'address-data', test: /src[\\/]data[\\/]countries\.json$/ },
            { name: 'phone-validation', test: /node_modules[\\/]libphonenumber-js[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: { '/api': { target: process.env.HAVEN_API_TARGET || 'http://127.0.0.1:5000', changeOrigin: true } },
  },
});
