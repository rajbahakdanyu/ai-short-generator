import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import {studioApi} from './server/studio-api.ts';

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{name: 'react-runtime', test: /[/]node_modules[/](?:react|react-dom|scheduler)[/]/}],
        },
      },
    },
  },
  optimizeDeps: {include: ['zod']},
  plugins: [react(), studioApi()],
  server: {host: '127.0.0.1', port: 5173, strictPort: true},
  preview: {host: '127.0.0.1', port: 5173, strictPort: true},
});
