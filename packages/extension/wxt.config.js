import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// See https://wxt.dev/api/config.html
export default defineConfig({
	srcDir: 'src',
	modules: ['@wxt-dev/module-react'],
	webExt: {
		chromiumProfile: chromeProfile,
		keepProfileChanges: true,
		chromiumArgs: ['--hide-crash-restore-bubble'],
	},
	vite: () => ({
		plugins: [tailwindcss()],
		define: {
			__VERSION__: JSON.stringify(pkg.version),
		},
		optimizeDeps: {
			force: true,
		},
		build: {
			minify: false,
			chunkSizeWarningLimit: 2000,
			cssCodeSplit: true,
			rollupOptions: {
				onwarn: function (message, handler) {
					if (message.code === 'EVAL') return
					handler(message)
				},
			},
		},
	}),
	zip: {
		artifactTemplate: 'page-steer-{{version}}-{{browser}}.zip',
	},
	manifest: ({ mode }) => ({
		// Fixed extension ID for local development only. The Chrome Web Store
		// assigns and injects its own key, so the published build must NOT ship one.
		...(mode === 'production'
			? {}
			: {
					key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqbzT0iTYeYlnCvDJIGDnGU8oarJgZILDzSfLi/ufuSxXEPDKuMyD892GhvrMCZNVHS11Sh6NYUOc/PcUOhtaR2urHtcNkrpSJNV10zUamY7fxBdVEkOucfyLu8INVy+teis62MoRWYPaUPkfZUjrLGW8MsZ9aFzARfu9GGDEp2EAYsWDN6w6vyz9LJ82pm542EWnVT4MjmDPgvYFCWGBtaU/dfHD+GAX6URJFapsCvryVURKJ+76c/GO9/I3EX1IBfbY6dec78bLCMvVxiTmiv36KyGPwX1OpakW8IiCpXWdbAxjm+plbYlp5t5zTyyoE3sOSFeXsBH0Kg27o8GcvQIDAQAB',
				}),
		default_locale: 'en',
		name: '__MSG_extName__',
		description: '__MSG_extDescription__',
		homepage_url: 'https://cookiebody.github.io/docs/page-steer/',
		permissions: [
			'tabs',
			'tabGroups',
			'sidePanel',
			'storage',
			'scripting',
			'downloads',
			'nativeMessaging',
		],
		host_permissions: ['<all_urls>'],
		icons: {
			16: 'assets/page-steer-16.png',
			32: 'assets/page-steer-32.png',
			48: 'assets/page-steer-48.png',
			64: 'assets/page-steer-64.png',
			128: 'assets/page-steer-128.png',
		},
		action: {
			default_title: '__MSG_extActionTitle__',
			default_icon: {
				16: 'assets/page-steer-16.png',
				32: 'assets/page-steer-32.png',
				48: 'assets/page-steer-48.png',
				128: 'assets/page-steer-128.png',
			},
		},
		web_accessible_resources: [
			{
				resources: ['main-world.js'],
				matches: ['*://*/*'],
			},
		],
		side_panel: {
			default_path: 'sidepanel/index.html',
		},
		externally_connectable: {
			matches: ['http://localhost/*'],
		},
	}),
})
