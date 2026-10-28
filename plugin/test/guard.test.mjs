import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用临时 DSH_HOME，避免读到真实配置
const home = mkdtempSync(join(tmpdir(), 'prevent-peep-'))
process.env.DSH_HOME = home

const { apply, collect, _resetForTest } = await import('../lib/index.js')
const { mergeState } = await import('../lib/state.js')

// 测试里关掉所有提醒，避免在 Windows 上真的弹窗、响铃
const QUIET = { alertSound: false, alertCustom: false, alertToast: false, alertPopup: false }

let handler
apply({ on: (event, h) => { if (event === 'tools/pre-execute') handler = h } }, {
  mode: 'ask',
  enforceRoots: ['D:\\'],
  allowRoots: ['D:\\TE_Code', 'D:\\DSH'],
  denyRoots: [],
  scanShell: true,
  relativeBase: 'C:\\Users\\TE\\Documents\\deepseek-harness\\default-workspace',
  ...QUIET,
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

const read = (p) => ({ name: 'read', arguments: { file_path: p } })
const pwsh = (c) => ({ name: 'pwsh', arguments: { command: c } })

console.log('— 基本规则')
await expect('read D:\\2学习\\a.txt', read('D:\\2学习\\a.txt'), 'ask')
await expect('read D:\\TE_Code\\a.txt', read('D:\\TE_Code\\a.txt'), 'allow')
await expect('read D:\\DSH\\version', read('D:\\DSH\\version'), 'allow')
await expect('read D:\\DSH2\\x', read('D:\\DSH2\\x'), 'ask')
await expect('read C:\\temp\\a.txt', read('C:\\temp\\a.txt'), 'allow')
await expect('read relative a.txt', read('a.txt'), 'allow')
await expect('glob D:\\2学习', { name: 'glob', arguments: { pattern: '**/*.txt', path: 'D:\\2学习' } }, 'ask')
await expect('pwsh mentions D:\\2学习', pwsh('Get-ChildItem D:\\2学习'), 'ask')
await expect('pwsh only TE_Code', pwsh('Get-Content D:\\TE_Code\\a.txt'), 'allow')
await expect('pwsh no D', pwsh('Get-Date'), 'allow')
await expect('cd D:\\2学习', { name: 'working_directory', arguments: { cd: 'D:\\2学习' } }, 'ask')
await expect('write D:\\TE_Code\\new.txt', { name: 'write', arguments: { file_path: 'D:\\TE_Code\\new.txt' } }, 'allow')
await expect('edit D:\\2学习\\a.txt', { name: 'edit', arguments: { file_path: 'D:\\2学习\\a.txt' } }, 'ask')

console.log('— 以前能绕过的写法（现在都要拦）')
await expect('白名单 + ..：D:\\TE_Code\\..\\2学习\\a.txt', read('D:\\TE_Code\\..\\2学习\\a.txt'), 'ask')
await expect('长路径前缀：\\\\?\\D:\\2学习\\a.txt', read('\\\\?\\D:\\2学习\\a.txt'), 'ask')
await expect('本机共享：\\\\localhost\\D$\\2学习\\a.txt', read('\\\\localhost\\D$\\2学习\\a.txt'), 'ask')
await expect('盘符相对：D:2学习\\a.txt', read('D:2学习\\a.txt'), 'ask')
await expect('正斜杠：D:/2学习/a.txt', read('D:/2学习/a.txt'), 'ask')
await expect('大小写：d:\\2学习\\A.TXT', read('d:\\2学习\\A.TXT'), 'ask')
await expect('glob pattern 写绝对路径', { name: 'glob', arguments: { pattern: 'D:/2学习/**/*' } }, 'ask')
await expect('pwsh 白名单 + 越界同一条命令', pwsh('cat D:\\TE_Code\\x; cat D:\\2学习\\a.txt'), 'ask')
await expect('pwsh 正斜杠', pwsh('Get-ChildItem D:/2学习'), 'ask')
await expect('pwsh 只写盘符：cd D:', pwsh('cd D:; ls'), 'ask')
await expect('pwsh 引号里的路径', pwsh('Get-Content "D:\\2学习\\a b.txt"'), 'ask')

console.log('— 不该误报的')
await expect('D:\\TE_Code\\..\\TE_Code\\a.txt', read('D:\\TE_Code\\..\\TE_Code\\a.txt'), 'allow')
await expect('pwsh 两个都在白名单', pwsh('cat D:\\TE_Code\\a; cat D:\\DSH\\b'), 'allow')
await expect('pwsh 网址', pwsh('curl https://example.com/a:b'), 'allow')
await expect('pwsh 时间格式', pwsh("Get-Date -Format 'HH:mm:ss'"), 'allow')
await expect('grep 正则', { name: 'grep', arguments: { pattern: '\\d+:\\d+', path: 'D:\\TE_Code' } }, 'allow')
await expect('写入的内容里提到 D 盘（content 不检查）', { name: 'write', arguments: { file_path: 'D:\\TE_Code\\n.md', content: '资料在 D:\\2学习' } }, 'allow')

// 提示文案
const banner = await handler(read('D:\\2学习\\a.txt'), next)
const zh = banner.displayReason?.zh ?? ''
if (zh.startsWith('大肥鱼安全助手提醒您：')) console.log('PASS  提示前缀正确')
else { failed++; console.log('FAIL  提示前缀：' + zh) }

console.log('— 符号链接 / 目录联接（模拟真实路径解析）')
{
  const state = mergeState({ enforceRoots: ['D:\\'], allowRoots: ['D:\\TE_Code'], ...QUIET }, undefined)
  const fakeReal = (p) => p.toLowerCase().startsWith('d:\\te_code\\link') ? 'D:\\2学习' + p.slice('D:\\TE_Code\\link'.length) : p
  const got = collect(read('D:\\TE_Code\\link\\a.txt'), state, fakeReal)
  const ok = got.length === 1 && got[0] === 'D:\\2学习\\a.txt'
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  白名单里的联接指向 D:\\2学习 → ${JSON.stringify(got)}`)
}

console.log('— 状态文件覆盖')
writeFileSync(join(home, 'prevent-peep.json'), JSON.stringify({
  mode: 'deny',
  enforceRoots: ['D:\\'],
  allowRoots: ['D:\\TE_Code'],
  denyRoots: ['C:\\secret'],
  scanShell: false,
}))
await new Promise((r) => setTimeout(r, 1100))

await expect('state: C:\\secret 命中黑名单', read('C:\\secret\\a.txt'), 'deny')
await expect('state: D:\\2学习 仍受管', read('D:\\2学习\\a.txt'), 'deny')
await expect('state: D:\\TE_Code 放行', read('D:\\TE_Code\\a.txt'), 'allow')
await expect('state: scanShell 关闭时不扫命令', pwsh('cat D:\\2学习\\a.txt'), 'allow')

console.log('— 黑名单也要扫 shell 命令')
writeFileSync(join(home, 'prevent-peep.json'), JSON.stringify({
  mode: 'ask', enforceRoots: ['D:\\'], allowRoots: ['D:\\TE_Code'], denyRoots: ['C:\\secret', 'D:\\TE_Code\\私密'],
  scanShell: true, ...QUIET,
}))
await new Promise((r) => setTimeout(r, 1100))
await expect('pwsh 读黑名单 C:\\secret', pwsh('Get-Content C:\\secret\\a.txt'), 'ask')
await expect('白名单里的黑名单子目录', read('D:\\TE_Code\\私密\\a.txt'), 'ask')

console.log('— 跟踪 working_directory 作为相对路径基准')
writeFileSync(join(home, 'prevent-peep.json'), JSON.stringify({
  mode: 'ask', enforceRoots: ['D:\\'], allowRoots: ['D:\\TE_Code'], relativeBase: '', ...QUIET,
}))
await new Promise((r) => setTimeout(r, 1100))
_resetForTest()
await expect('没有基准时，相对路径无法判定（放行）', read('..\\..\\2学习\\a.txt'), 'allow')
await expect('cd D:\\TE_Code\\proj', { name: 'working_directory', arguments: { cd: 'D:\\TE_Code\\proj' } }, 'allow')
await expect('之后 ..\\..\\2学习\\a.txt 越界', read('..\\..\\2学习\\a.txt'), 'ask')
await expect('之后 src\\a.ts 在白名单内', read('src\\a.ts'), 'allow')
await expect('之后 \\2学习\\a.txt（根相对）越界', read('\\2学习\\a.txt'), 'ask')

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
