import path from 'path';
import { defineConfig } from 'vite';

// Stock Strudel in the browser, through rn-strudel's web entry (the same initStrudel() API as the app). The feature rows
// and runner live one directory up, shared with the Expo example; Strudel's packages resolve from the library's own
// node_modules, so there is exactly one superdough.
export default defineConfig({
  resolve: {
    alias: { 'rn-strudel': path.resolve(__dirname, '../src/index.web.ts') },
  },
  server: { fs: { allow: ['..'] } },
});
