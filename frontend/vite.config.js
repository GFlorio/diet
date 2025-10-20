import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  build: {
    rollupOptions: {
      input: 'index.html'
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,ts}'],
    coverage: {
      reporter: ['text', 'html'],
    }
  }
});
