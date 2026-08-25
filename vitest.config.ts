import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    alias: {
      '#/': new URL('./src/', import.meta.url).pathname,
    },
  },
})
