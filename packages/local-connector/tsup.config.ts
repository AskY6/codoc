import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      'client/browser': 'src/client/browser.ts'
    },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    clean: true
  },
  {
    entry: {
      'daemon/main': 'src/daemon/main.ts',
      'node/index': 'src/node/index.ts',
      'shared/index': 'src/shared/index.ts'
    },
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    dts: true,
    sourcemap: true
  }
])
