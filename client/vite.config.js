import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = { host: '0.0.0.0', port: 5173, strictPort: true };
if (process.env.VITE_ALLOWED_HOST) server.allowedHosts = [process.env.VITE_ALLOWED_HOST];

export default defineConfig({ plugins: [react()], server });
