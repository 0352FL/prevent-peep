import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用临时 DSH_HOME，避免读到真实配置
const home = mkdtempSync(join(tmpdir(), 'prevent-peep-'))
process.env.DSH_HOME = home

const { apply, collect, inspect, _resetForTest } = await import('../lib/index.js')
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

console.log('— Windows 忽略尾随点/空格；卷 GUID 无法换算')
writeFileSync(join(home, 'prevent-peep.json'), JSON.stringify({
  mode: 'ask', enforceRoots: [], allowRoots: ['D:\\TE_Code'], denyRoots: ['D:\\2学习'], scanShell: false, ...QUIET,
}))
await new Promise((r) => setTimeout(r, 1100))
_resetForTest()
await expect('D:\\2学习.\\a.txt（尾随点）', read('D:\\2学习.\\a.txt'), 'ask')
await expect('D:\\2学习 \\a.txt（尾随空格）', read('D:\\2学习 \\a.txt'), 'ask')
await expect('D:\\2学习..\\a.txt（多个尾随点）', read('D:\\2学习..\\a.txt'), 'ask')
await expect('卷 GUID 路径 -> 无法换算，拦截', read('\\\\?\\Volume{12345678-1234-1234-1234-123456789012}\\2学习\\a'), 'ask')
await expect('白名单内正常路径仍放行', read('D:\\TE_Code\\a.txt'), 'allow')
// ---------------------------------------------------------------------------
// 1.352.2：第二轮修补（直接调用 inspect，不走状态文件，跑得快）
// ---------------------------------------------------------------------------
const ENV = { USERPROFILE: 'C:\\Users\\TE', TEMP: 'C:\\Users\\TE\\AppData\\Local\\Temp' }
_resetForTest(ENV)
const BASE = {
  mode: 'ask',
  enforceRoots: ['D:\\', 'C:\\Users\\TE\\Secret'],
  allowRoots: ['D:\\TE_Code', 'D:\\DSH'],
  denyRoots: [],
  relativeBase: 'D:\\TE_Code\\proj',
  protectedRoots: ['C:\\Users\\TE\\.dsh'],
  ...QUIET,
}
const same = (p) => p
function verdict(exec, extra) {
  const r = inspect(exec, mergeState({ ...BASE, ...(extra ?? {}) }, undefined), same)
  return r.blocked.length > 0 ? 'deny' : r.found.length > 0 ? 'ask' : 'allow'
}
function hit(label, exec, want, extra) {
  const got = verdict(exec, extra)
  const ok = got === want
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${got.padEnd(5)} (want ${want})  ${label}`)
}
const bash = (c) => ({ name: 'bash', arguments: { command: c } })
const write = (p, content) => ({ name: 'write', arguments: { file_path: p, content } })

console.log('— 少见的路径写法')
hit('\\\\.\\Volume{GUID}\\…', read('\\\\.\\Volume{0f1e2d3c-1111-2222-3333-444455556666}\\2学习\\a.txt'), 'ask')
hit('\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\…', read('\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\2学习\\a.txt'), 'ask')
hit('卷影副本', read('\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1\\2学习\\a.txt'), 'ask')
hit('\\\\电脑名\\D$\\…', read('\\\\TE-PC\\D$\\2学习\\a.txt'), 'ask')
hit('\\\\局域网IP\\D$\\…', read('\\\\192.168.1.5\\D$\\2学习\\a.txt'), 'ask')
hit('\\\\127.0.0.2\\D$\\…', read('\\\\127.0.0.2\\D$\\2学习\\a.txt'), 'ask')
hit('\\\\0--1.ipv6-literal.net\\D$\\…', read('\\\\0--1.ipv6-literal.net\\D$\\2学习\\a.txt'), 'ask')
hit('\\\\wsl$\\Ubuntu\\mnt\\d\\…', read('\\\\wsl$\\Ubuntu\\mnt\\d\\2学习\\a.txt'), 'ask')
hit('\\\\wsl.localhost\\Ubuntu\\mnt\\d\\…', read('\\\\wsl.localhost\\Ubuntu\\mnt\\d\\2学习\\a.txt'), 'ask')
hit('file:///D:/2学习/a.txt', read('file:///D:/2学习/a.txt'), 'ask')
hit('file URI 里的百分号编码', read('file:///D:/2%E5%AD%A6%E4%B9%A0/a.txt'), 'ask')
hit('/mnt/d/2学习（路径参数）', read('/mnt/d/2学习/a.txt'), 'ask')
hit('白名单的 file URI 放行', read('file:///D:/TE_Code/a.txt'), 'allow')
hit('没配置名单时设备路径不管', read('\\\\.\\Volume{1}\\x'), 'allow', { enforceRoots: [], denyRoots: [] })

console.log('— shell 里的 WSL / Git Bash / Cygwin 写法')
hit('bash: cat /mnt/d/2学习/a.txt', bash('cat /mnt/d/2学习/a.txt'), 'ask')
hit('bash: cat /d/2学习/a.txt', bash('cat /d/2学习/a.txt'), 'ask')
hit('bash: ls /cygdrive/d/2学习', bash('ls /cygdrive/d/2学习'), 'ask')
hit('pwsh: wsl cat /mnt/d/2学习/a.txt', pwsh('wsl cat /mnt/d/2学习/a.txt'), 'ask')
hit('bash: /mnt/d/TE_Code 放行', bash('ls /mnt/d/TE_Code/src'), 'allow')
hit('cmd /c dir 不误报', pwsh('cmd /c dir'), 'allow')
hit('sed s/a/b/ 不误报', bash("sed -i 's/a/b/' x.txt"), 'allow')

console.log('— 环境变量和 ~')
hit('read ~\\Secret\\a.txt', read('~\\Secret\\a.txt'), 'ask')
hit('read %USERPROFILE%\\Secret\\a.txt', read('%USERPROFILE%\\Secret\\a.txt'), 'ask')
hit('pwsh: gc $env:USERPROFILE\\Secret\\a.txt', pwsh('gc $env:USERPROFILE\\Secret\\a.txt'), 'ask')
hit('pwsh: gc ${env:USERPROFILE}\\Secret\\a.txt', pwsh('gc ${env:USERPROFILE}\\Secret\\a.txt'), 'ask')
hit('bash: cat ~/Secret/a.txt', bash('cat ~/Secret/a.txt'), 'ask')
hit('bash: cat $HOME/Secret/a.txt', bash('cat $HOME/Secret/a.txt'), 'ask')
hit('pwsh: ls ~\\Desktop 放行', pwsh('ls ~\\Desktop'), 'allow')

console.log('— 先 cd 再用相对路径')
hit('pwsh: cd ..\\..; dir（落到 D:\\）', pwsh('cd ..\\..; dir'), 'ask')
hit('pwsh: Set-Location -Path "D:\\2学习"', pwsh('Set-Location -Path "D:\\2学习"; ls'), 'ask')
hit('cmd: cd /d D:\\2学习', pwsh('cmd /c "cd /d D:\\2学习 && dir"'), 'ask')
hit('pwsh: cd src 放行', pwsh('cd src; npm test'), 'allow')
hit('pwsh workdir 作为基准：cd ..', { name: 'pwsh', arguments: { workdir: 'D:\\TE_Code', command: 'cd ..; dir' } }, 'ask')

console.log('— 相对 glob 模式、换了名字的参数')
hit('glob ..\\..\\2学习\\*', { name: 'glob', arguments: { pattern: '..\\..\\2学习\\*' } }, 'ask')
hit('glob path=D:\\TE_Code + pattern ../2学习/**', { name: 'glob', arguments: { path: 'D:\\TE_Code', pattern: '../2学习/**/*' } }, 'ask')
hit('glob **/*.ts 放行', { name: 'glob', arguments: { pattern: '**/*.ts' } }, 'allow')
hit('其他工具的 filename 参数', { name: 'some_mcp_tool', arguments: { filename: 'D:\\2学习\\a.txt' } }, 'ask')
hit('其他工具的嵌套参数', { name: 'some_mcp_tool', arguments: { options: { target: 'D:\\2学习' } } }, 'ask')

console.log('— 先写脚本再运行')
hit('write scan.py 里 os.walk("D:/2学习")', write('D:\\TE_Code\\scan.py', 'import os\nfor r, d, f in os.walk("D:/2学习"): print(f)'), 'ask')
hit('write x.ps1 里 gc D:\\2学习', write('D:\\TE_Code\\x.ps1', 'Get-Content D:\\2学习\\a.txt'), 'ask')
hit('write x.sh 里 cat /mnt/d/2学习', write('D:\\TE_Code\\x.sh', 'cat /mnt/d/2学习/a.txt'), 'ask')
hit('write x.ps1 里 cd ..\\..', write('D:\\TE_Code\\proj\\x.ps1', 'cd ..\\..\nls'), 'ask')
hit('edit 脚本 new_string 里有路径', { name: 'edit', arguments: { file_path: 'D:\\TE_Code\\a.js', old_string: 'x', new_string: 'fs.readdirSync("D:\\\\2学习")' } }, 'ask')
hit('edit 脚本 old_string 里有路径（不管）', { name: 'edit', arguments: { file_path: 'D:\\TE_Code\\a.js', old_string: 'fs.readdirSync("D:\\\\2学习")', new_string: 'x' } }, 'allow')
hit('write 文档 .md 里提到路径（不管）', write('D:\\TE_Code\\notes.md', '资料在 D:\\2学习'), 'allow')
hit('write 脚本只用白名单路径', write('D:\\TE_Code\\x.py', 'open("D:/TE_Code/a.txt")'), 'allow')
hit('scanScripts 关掉后不扫', write('D:\\TE_Code\\scan.py', 'os.walk("D:/2学习")'), 'allow', { scanScripts: false })

console.log('— 可疑命令')
hit('subst', pwsh('subst S: D:\\TE_Code'), 'ask')
hit('New-PSDrive', pwsh('New-PSDrive -Name S -PSProvider FileSystem -Root D:\\TE_Code'), 'ask')
hit('mklink', pwsh('cmd /c mklink /J D:\\TE_Code\\link C:\\Users'), 'ask')
hit('New-Item -ItemType Junction', pwsh('New-Item -ItemType Junction -Path link -Target ..'), 'ask')
hit('fsutil hardlink', pwsh('fsutil hardlink create a b'), 'ask')
hit('-EncodedCommand', pwsh('powershell -EncodedCommand ZwBjACAARAA6AFwAeAA='), 'ask')
hit('-enc 缩写', pwsh('powershell -enc ZwBjACAARAA6AFwAeAA='), 'ask')
hit('dsh plugin remove', pwsh('dsh plugin --profile desktop remove prevent-peep'), 'ask')
hit('net use', pwsh('net use Z: \\\\TE-PC\\Share'), 'ask')
hit('node -e 不误报', pwsh('node -e "console.log(1)"'), 'allow')
hit('suspiciousCommands 关掉', pwsh('subst S: D:\\TE_Code'), 'allow', { suspiciousCommands: false })

console.log('— 保护插件配置（不受 mode 影响，一律拒绝）')
hit('write prevent-peep.json', write('C:\\Users\\TE\\.dsh\\prevent-peep.json', '{}'), 'deny')
hit('edit settings.yaml', { name: 'edit', arguments: { file_path: 'C:\\Users\\TE\\.dsh\\settings.yaml', old_string: 'a', new_string: 'b' } }, 'deny')
hit('用 ~ 写配置', write('~\\.dsh\\prevent-peep.json', '{}'), 'deny')
hit('read 配置放行', read('C:\\Users\\TE\\.dsh\\prevent-peep.json'), 'allow')
hit('shell 改配置 → 询问', pwsh('Set-Content ~\\.dsh\\prevent-peep.json "{}"'), 'ask')
hit('脚本里写配置 → 拒绝', write('D:\\TE_Code\\x.py', 'open(r"C:\\Users\\TE\\.dsh\\prevent-peep.json", "w")'), 'deny')

// 端到端：拒绝原因里要叫模型别绕
_resetForTest(ENV)
writeFileSync(join(home, 'prevent-peep.json'), JSON.stringify({ ...BASE }))
await new Promise((r) => setTimeout(r, 1100))
{
  const r1 = await handler(write('C:\\Users\\TE\\.dsh\\prevent-peep.json', '{}'), next)
  const ok1 = r1.kind === 'deny'
  if (!ok1) failed++
  console.log(`${ok1 ? 'PASS' : 'FAIL'}  ${r1.kind.padEnd(5)} (want deny)  ask 模式下写受保护配置也直接拒绝`)
  const r2 = await handler(read('D:\\2学习\\a.txt'), next)
  const ok2 = /Do not try to reach them another way/.test(r2.reason) && /不要用脚本/.test(r2.reason)
  if (!ok2) failed++
  console.log(`${ok2 ? 'PASS' : 'FAIL'}  拒绝原因里告诉模型不要绕过`)
}

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
