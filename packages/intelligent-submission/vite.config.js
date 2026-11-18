import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/intelligent-submission/',
  plugins: [react()],
  build: { outDir: 'dist' },
});
