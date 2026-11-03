import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { redact } from '@tanstack/redact/vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
	root,
	base: '/build/start/',
	publicDir: false,
	resolve: {
		alias: [
			{ find: /^#client\//, replacement: `${root}client/` },
			{ find: /^#universal\//, replacement: `${root}universal/` },
		],
	},
	plugins: [
		redact(),
		tanstackStart({
			srcDirectory: 'start',
			router: { basepath: '/' },
			server: { entry: 'server.ts' },
		}),
		react({
			include: /\/start\/.*\.[jt]sx?$/,
			jsxImportSource: '@emotion/react',
		}),
	],
	ssr: { noExternal: true },
	environments: {
		client: { build: { outDir: `${root}public/build/start` } },
		ssr: { build: { outDir: `${root}.start/server` } },
	},
})
