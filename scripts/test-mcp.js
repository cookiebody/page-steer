#!/usr/bin/env node
/**
 * Simple MCP command tester.
 *
 * Usage:
 *   1. Run: node scripts/test-mcp.js
 *   2. Open http://localhost:38401 in Chrome (extension must be installed)
 *   3. The extension hub will auto-connect, then tests run.
 */
import { HubBridge } from '../packages/mcp/src/hub-bridge.js'

const PORT = 38401
const bridge = new HubBridge(PORT)

await bridge.start()
console.log(`\n🚀 Server ready on port ${PORT}`)
console.log(``)
console.log(`   请在 Chrome 地址栏输入并打开：`)
console.log(`   chrome-extension://akldabonmimlicnjlflnapfeklbfemhj/hub.html?ws=${PORT}`)
console.log(``)
console.log(`   等待 hub 连接...`)

// Wait for hub
let waited = 0
while (!bridge.connected) {
	await new Promise((r) => setTimeout(r, 500))
	waited += 500
	if (waited % 10_000 === 0) {
		console.log(`   ... 已等待 ${waited / 1000}s，仍在等待连接`)
	}
	if (waited > 120_000) {
		console.error('❌ Timeout waiting for hub connection (120s)')
		process.exit(1)
	}
}
console.log('✓ Hub connected!\n')
await new Promise((r) => setTimeout(r, 1000))

// ---- Test helpers ----

async function testCommand(name, command, params = {}) {
	console.log(`── ${name} ──`)
	console.log(`   → ${command}(${JSON.stringify(params)})`)
	try {
		const result = await bridge.sendCommand(command, params)
		const data =
			typeof result.data === 'string'
				? result.data.slice(0, 200)
				: JSON.stringify(result.data).slice(0, 200)
		console.log(`   ← success: ${result.success}`)
		console.log(`   ← ${data}${data.length >= 200 ? '...' : ''}`)
	} catch (err) {
		console.log(`   ← ERROR: ${err.message}`)
	}
	console.log('')
}

// ---- Run tests ----

try {
	await testCommand('Get page info', 'get_page_info')
	await testCommand('Get all tabs', 'get_tabs')
	await testCommand('Navigate', 'navigate', { url: 'https://example.com' })
	await new Promise((r) => setTimeout(r, 2500))
	await testCommand('Get page content', 'get_page_content')
	await testCommand('Get page info (after nav)', 'get_page_info')
	await testCommand('Execute JS', 'execute_javascript', { code: 'document.title' })
	await testCommand('Scroll down', 'scroll', { direction: 'down', amount: 1 })
	await testCommand('Open new tab', 'open_new_tab', { url: 'https://github.com' })
	await new Promise((r) => setTimeout(r, 3000))
	await testCommand('Get tabs', 'get_tabs')
	await testCommand('Get page info (new tab)', 'get_page_info')

	console.log('✅ All tests completed!')
} catch (err) {
	console.error(`❌ Test failed: ${err.message}`)
} finally {
	process.exit(0)
}
