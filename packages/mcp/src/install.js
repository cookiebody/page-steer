#!/usr/bin/env node
/**
 * Page Steer — Native Messaging Host Installer
 *
 * Registers the native messaging host manifest so Chrome can launch the native host.
 *
 * Usage:
 *   node packages/mcp/src/install.js [--uninstall]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOST_NAME = 'com.page_steer.native'
const EXT_ID = 'akldabonmimlicnjlflnapfeklbfemhj'

// Determine manifest directory based on platform
function getManifestDir() {
	switch (platform()) {
		case 'darwin':
			return join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
		case 'linux':
			return join(homedir(), '.config/google-chrome/NativeMessagingHosts')
		case 'win32':
			// On Windows, we'd need to write a registry key. For now, support macOS/Linux.
			return join(homedir(), 'AppData/Local/Google/Chrome/User Data/NativeMessagingHosts')
		default:
			throw new Error(`Unsupported platform: ${platform()}`)
	}
}

function getHostScriptPath() {
	return resolve(__dirname, 'run-native-host.sh')
}

function install() {
	const manifestDir = getManifestDir()
	const manifestPath = join(manifestDir, `${HOST_NAME}.json`)
	const hostScript = getHostScriptPath()

	// Create run script
	const nodeScript = resolve(__dirname, 'native-host.js')
	const runScript = `#!/usr/bin/env bash
exec node "${nodeScript}" 2>/dev/null
`
	writeFileSync(hostScript, runScript, { mode: 0o755 })

	// Create manifest
	const manifest = {
		name: HOST_NAME,
		description: 'Page Steer MCP Native Messaging Host',
		path: hostScript,
		type: 'stdio',
		allowed_origins: [`chrome-extension://${EXT_ID}/`],
	}

	mkdirSync(manifestDir, { recursive: true })
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

	console.log(`✓ Native messaging host installed`)
	console.log(`  Manifest: ${manifestPath}`)
	console.log(`  Host script: ${hostScript}`)
	console.log(`  Extension ID: ${EXT_ID}`)
	console.log(``)
	console.log(`  Native host SSE server will be available at: http://127.0.0.1:12315/sse`)
	console.log(``)
	console.log(`  Use this only for MCP clients that support remote/SSE servers:`)
	console.log(`  {`)
	console.log(`    "mcpServers": {`)
	console.log(`      "page-steer": {`)
	console.log(`        "url": "http://127.0.0.1:12315/sse"`)
	console.log(`      }`)
	console.log(`    }`)
	console.log(`  }`)
	console.log(``)
	console.log(`  For stdio MCP clients, prefer: npx -y @page-steer/mcp`)
	console.log(`  After installing, restart Chrome and click the Page Steer extension icon.`)
}

function uninstall() {
	const manifestDir = getManifestDir()
	const manifestPath = join(manifestDir, `${HOST_NAME}.json`)
	const hostScript = getHostScriptPath()

	if (existsSync(manifestPath)) {
		rmSync(manifestPath)
		console.log(`✓ Removed manifest: ${manifestPath}`)
	}
	if (existsSync(hostScript)) {
		rmSync(hostScript)
		console.log(`✓ Removed host script: ${hostScript}`)
	}
	console.log(`✓ Native messaging host uninstalled`)
}

// --- Main ---
const args = process.argv.slice(2)
if (args.includes('--uninstall')) {
	uninstall()
} else {
	install()
}
