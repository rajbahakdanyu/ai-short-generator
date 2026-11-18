import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {studioApi} from './server/studio-api.ts';

export default defineConfig({
  plugins: [react(), studioApi()],
  server: {host: '127.0.0.1', port: 5173, strictPort: true},
  preview: {host: '127.0.0.1', port: 5173, strictPort: true},
});
