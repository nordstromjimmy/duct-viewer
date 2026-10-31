import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths, so the built app works from any folder:
  // GitHub Pages (https://<user>.github.io/<repo>/), a Raspberry Pi, or just opening dist/.
  base: './',
});
