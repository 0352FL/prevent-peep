import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用临时 DSH_HOME，避免读到真实配置
const home = mkdtempSync(join(tmpdir(), 'prevent-peep-'))
process.env.DSH_HOME = home

const { apply } = await import('../lib/index.js')

let handler
apply({ on: (event, h) => { if (event === 'tools/pre-execute') handler = h } }, {
  mode: 'ask',
  enforceRoots: ['D:\\'],
  allowRoots: ['D:\\TE_Code', 'D:\\DSH'],
  denyRoots: [],
  scanShell: true,
  relativeBase: 'C:\\Users\\TE\\Documents\\deepseek-harness\\default-workspace',
})

const next = async () => ({ kind: 'allow' })
let failed = 0

async function expect(label, exec, want) {
  const result = await handler(exec, next)
  const ok = result.kind === want
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(result.kind).padEnd(5)} (want ${want})  ${label}`)
  return result
}

await expect('read D:\\2学习\\a.txt', { name: 'read', arguments: { file_path: 'D:\\2学习\\a.txt' } }, 'ask')
await expect('read D:\\TE_Code\\a.txt', { name: 'read', arguments: { file_path: 'D:\\TE_Code\\a.txt' } }, 'allow')
await expect('read D:\\DSH\\version', { name: 'read', arguments: { file_path: 'D:\\DSH\\version' } }, 'allow')
await expect('read D:\\DSH2\\x', { name: 'read', arguments: { file_path: 'D:\\DSH2\\x' } }, 'ask')
await expect('read C:\\temp\\a.txt', { name: 'read', arguments: { file_path: 'C:\\temp\\a.txt' } }, 'allow')
await expect('read relative a.txt', { name: 'read', arguments: { file_path: 'a.txt' } }, 'allow')
await expect('glob D:\\2学习', { name: 'glob', arguments: { pattern: '**/*.txt', path: 'D:\\2学习' } }, 'ask')
await expect('pwsh mentions D:\\2学习', { name: 'pwsh', arguments: { command: 'Get-ChildItem D:\\2学习' } }, 'ask')
await expect('pwsh only TE_Code', { name: 'pwsh', arguments: { command: 'Get-Content D:\\TE_Code\\a.txt' } }, 'allow')
await expect('pwsh no D', { name: 'pwsh', arguments: { command: 'Get-Date' } }, 'allow')
await expect('cd D:\\2学习', { name: 'working_directory', arguments: { cd: 'D:\\2学习' } }, 'ask')
await expect('write D:\\TE_Code\\new.txt', { name: 'write', arguments: { file_path: 'D:\\TE_Code\\new.txt' } }, 'allow')
await expect('edit D:\\2学习\\a.txt', { name: 'edit', arguments: { file_path: 'D:\\2学习\\a.txt' } }, 'ask')

// 提示文案
const banner = await handler({ name: 'read', arguments: { file_path: 'D:\\2学习\\a.txt' } }, next)
const zh = banner.displayReason?.zh ?? ''
if (zh.startsWith('大肥鱼安全助手提醒您：')) console.log('PASS  提示前缀正确')
else { failed++; console.log('FAIL  提示前缀：' + zh) }

// 状态文件覆盖（含 IO 缓存 1s，等待失效）
writeFileSync(join(home, 'prevent-peep.json'), JSON.stringify({
  mode: 'deny',
  enforceRoots: ['D:\\'],
  allowRoots: ['D:\\TE_Code'],
  denyRoots: ['C:\\secret'],
  scanShell: false,
}))
await new Promise((r) => setTimeout(r, 1100))

await expect('state: C:\\secret 命中黑名单', { name: 'read', arguments: { file_path: 'C:\\secret\\a.txt' } }, 'deny')
await expect('state: D:\\2学习 仍受管', { name: 'read', arguments: { file_path: 'D:\\2学习\\a.txt' } }, 'deny')
await expect('state: D:\\TE_Code 放行', { name: 'read', arguments: { file_path: 'D:\\TE_Code\\a.txt' } }, 'allow')

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
