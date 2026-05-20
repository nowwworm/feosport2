import EnvironmentPlugin from 'vite-plugin-environment';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { version as pkgVersion } from './package.json';
import { existsSync } from 'fs';
import path from 'path';

// Resolves sibling packages whether running locally or inside Docker.
// In Docker the entire feoTEST/ directory is copied to /app, so __dirname
// is /app/TMX and the parent is /app — which is exactly where the packages live.
const BASE = path.resolve(__dirname, '..');
const SRC  = path.resolve(__dirname, 'src');

const localPackageAliases = () => {
  if (process.env.TMX_USE_LOCAL_PACKAGES === 'false') return [];

  const aliases = [];

  if (existsSync(path.join(BASE, 'courthive-components/dist/courthive-components.es.js'))) {
    aliases.push(
      { find: /^courthive-components\/dist\/(.+)$/, replacement: `${BASE}/courthive-components/dist/$1` },
      { find: /^courthive-components$/,             replacement: `${BASE}/courthive-components/dist/courthive-components.es.js` },
    );
  }

  if (existsSync(path.join(BASE, 'factory/dist/index.mjs'))) {
    aliases.push({ find: /^tods-competition-factory$/, replacement: `${BASE}/factory/dist/index.mjs` });
  }

  if (existsSync(path.join(BASE, 'pdf-factory/dist/pdf-factory.js'))) {
    aliases.push({ find: /^pdf-factory$/, replacement: `${BASE}/pdf-factory/dist/pdf-factory.js` });
  }

  if (existsSync(path.join(BASE, 'scoringVisualizations/dist/scoring-visualizations.es.js'))) {
    aliases.push({
      find: /^@courthive\/scoring-visualizations$/,
      replacement: `${BASE}/scoringVisualizations/dist/scoring-visualizations.es.js`,
    });
  }

  if (existsSync(path.join(BASE, 'provider-config/dist/index.js'))) {
    aliases.push({ find: /^@courthive\/provider-config$/, replacement: `${BASE}/provider-config/dist` });
  }

  return aliases;
};

const emitVersionJson = (): Plugin => ({
  name: 'tmx-emit-version-json',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ version: pkgVersion, builtAt: new Date().toISOString() }) + '\n',
    });
  },
});

const viteconfigFactory = ({ mode }: { mode: string }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const BASE_URL = (process.env.BASE_URL && `/${process.env.BASE_URL}/`) || '';

  return defineConfig({
    plugins: [EnvironmentPlugin({ SERVER: '', ENVIRONMENT: '', PUBLIC_URL: '' }), emitVersionJson()],
    server: {
      port: 5176,
      strictPort: false,
    },
    optimizeDeps: {
      include: ['@courthive/provider-config'],
      exclude: [
        'courthive-components',
        'tods-competition-factory',
        'pdf-factory',
        '@courthive/scoring-visualizations',
      ],
    },
    resolve: {
      alias: [
        // ── Local monorepo packages ──────────────────────────────────────
        ...localPackageAliases(),

        // ── tsconfig paths (subpaths first, then exact) ──────────────────
        { find: /^assets\/(.+)$/,      replacement: `${SRC}/assets/$1` },
        { find: /^components\/(.+)$/,  replacement: `${SRC}/components/$1` },
        { find: /^config\/(.+)$/,      replacement: `${SRC}/config/$1` },
        { find: /^constants\/(.+)$/,   replacement: `${SRC}/constants/$1` },
        { find: /^functions\/(.+)$/,   replacement: `${SRC}/functions/$1` },
        { find: /^i18n\/(.+)$/,        replacement: `${SRC}/i18n/$1` },
        { find: /^i18n$/,              replacement: `${SRC}/i18n/index.ts` },
        { find: /^pages\/(.+)$/,       replacement: `${SRC}/pages/$1` },
        { find: /^platform\/(.+)$/,    replacement: `${SRC}/platform/$1` },
        { find: /^platform$/,          replacement: `${SRC}/platform/index.ts` },
        { find: /^router\/(.+)$/,      replacement: `${SRC}/router/$1` },
        { find: /^services\/(.+)$/,    replacement: `${SRC}/services/$1` },
        { find: /^settings\/(.+)$/,    replacement: `${SRC}/settings/$1` },
        { find: /^styles\/(.+)$/,      replacement: `${SRC}/styles/$1` },
        { find: /^styles$/,            replacement: `${SRC}/styles` },
        { find: /^types\/(.+)$/,       replacement: `${SRC}/types/$1` },
        { find: /^utilities\/(.+)$/,   replacement: `${SRC}/utilities/$1` },
        { find: /^homeNavigation$/,    replacement: `${SRC}/homeNavigation.ts` },
        { find: /^navigation$/,        replacement: `${SRC}/navigation.ts` },
      ],
    },
    build: {
      sourcemap: true,
      rolldownOptions: {
        onwarn(warning, defaultHandler) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return;
          defaultHandler(warning);
        },
      },
    },
    base: BASE_URL,
    test: {
      exclude: ['e2e/**', 'node_modules/**'],
    },
  });
};

export default viteconfigFactory;
