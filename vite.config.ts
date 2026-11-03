import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const buildTime = Date.now();

function versionPlugin(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          version: buildTime,
          buildTime,
          builtAt: new Date(buildTime).toISOString(),
        }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionPlugin()],
  define: {
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  base: './',
  server: {
    port: 5173,
    open: false,
  },
});
