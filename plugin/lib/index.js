/**
 * Prevent-peep — 在文件类工具真正执行前做路径守卫。
 *
 * 机制：监听 `tools/pre-execute` 瀑布事件。命中「黑名单 / 受管根内但不在白名单」
 * 的路径时返回 `ask`（由 Host 审批服务弹窗）或 `deny`（直接拒绝）。
 * 与 AGENTS.md 的软约束不同，这一层在工具派发前生效，不依赖模型自觉。
 *
 * 配置来自 $DSH_HOME/prevent-peep.json（用 大肥鱼我真该控制你了！.cmd 管理），
 * 缺省值由 profile 的 cordis.patch.yml 提供。改完保存即生效，无需重启。
 *
 * 局限（务必知情）：
 * - 只检查工具参数里的路径字符串；shell 里运行时拼接的路径（`"D:" + "\x"`、
 *   环境变量、先 cd 再用相对路径）无法可靠识别，命令串只做"提取像路径的片段"的启发式检查。
 * - 相对路径按 relativeBase（或跟踪到的 working_directory）解析；两者都没有时无法判定。
 *
 * @module prevent-peep
 */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadState, STATE_FILE } from './state.js'
import {
  CD_COMMAND,
  PATH_LIKE,
  POSIX_DRIVE,
  classify,
  expandVars,
  globPrefix,
  isProtected,
  normRoot,
  posixToWindows,
  toWindowsAbsolute,
} from './paths.js'

export const name = 'prevent-peep'
export const inject = ['tools']

/** 审批提示前缀。 */
const BANNER_ZH = '大肥鱼安全助手提醒您：'
const BANNER_EN = 'Big Fat Fish Security Assistant reminds you: '

/** 写给模型看的说明：明确禁止换办法绕过（配合型模型看到这句一般就会停下来问用户）。 */
const NO_WORKAROUND =
  ' The user has deliberately restricted access to these paths. Do not try to reach them another way' +
  ' (scripts, other shell commands, other tools, links, new drives, encoded commands, or editing this' +
  ' plugin\'s settings). If you really need them, stop and ask the user.' +
  ' 用户有意限制了对这些路径的访问，不要用脚本、其他命令、其他工具、链接、新盘符或修改本插件配置等方式绕过；确实需要时请停下来询问用户。'

/** DSH 配置目录（默认受保护）和插件自己的目录（可选保护）。 */
const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** shell 里需要用户确认的操作。 */
const SUSPICIOUS = [
  [/(?:^|[\s;&|(])-(?:e|ec|en|enc|enco|encod|encode|encoded\w*)\s+[A-Za-z0-9+/=]{8,}/i, 'EncodedCommand'],
  [/\bsubst\b/i, 'subst'],
  [/\bnew-psdrive\b|\bndr\b/i, 'New-PSDrive'],
  [/\bmklink\b/i, 'mklink'],
  [/-itemtype\s+['"]?(?:symboliclink|junction|hardlink)\b/i, 'New-Item link'],
  [/\bfsutil\s+hardlink\b/i, 'fsutil hardlink'],
  [/\bnet\s+use\b/i, 'net use'],
  [/\bdsh(?:\.exe|\.cmd)?\s+plugin\b/i, 'dsh plugin'],
]

/** 通过 working_directory 等工具跟踪到的当前工作目录（启发式，所有会话共用）。 */
let trackedCwd
/** 测试时可替换的环境变量来源。 */
let envSource = process.env

function currentBase(state) {
  return state.relativeBase ?? trackedCwd
}

/** 遍历参数里的所有字符串（数组元素沿用父级的参数名），限制深度防止恶意嵌套。 */
function walk(value, key, depth, visit) {
  if (depth > 8) return
  if (typeof value === 'string') {
    if (key !== undefined) visit(key, value)
  } else if (Array.isArray(value)) {
    for (const item of value) walk(item, key, depth + 1, visit)
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1, visit)
  }
}

function extensionOf(p) {
  const m = /\.[^.\\/]+$/.exec(String(p))
  return m === null ? '' : m[0].toLowerCase()
}

function protectedRootsOf(state) {
  const roots = [...state.protectedRoots]
  if (state.selfProtect) roots.push(normRoot(DSH_HOME))
  if (state.protectPluginDir) roots.push(normRoot(PLUGIN_ROOT))
  return [...new Set(roots.filter(Boolean))]
}

/**
 * 检查一次工具调用。
 * @returns found：越界的路径或可疑操作（按 mode 询问 / 拒绝）；blocked：写受保护目录（一律拒绝）
 */
export function inspect(exec, state, resolveReal) {
  const result = { found: [], blocked: [] }
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return result

  const env = envSource
  const isShell = state.shellTools.includes(exec.name)
  const isReadOnly = state.readOnlyTools.includes(exec.name)
  const protectedRoots = protectedRootsOf(state)
  const found = new Set()
  const blocked = new Set()

  // 相对路径的基准：shell 的 workdir、glob/grep 的 path 优先，其次是配置或跟踪到的工作目录
  const base0 = currentBase(state)
  let base = base0
  for (const key of ['workdir', 'cwd', 'path']) {
    if (typeof args[key] === 'string') {
      const abs = toWindowsAbsolute(args[key], base0, env)
      if (abs !== undefined) { base = abs; break }
    }
  }

  const check = (raw, relativeTo = base0) => {
    const abs = toWindowsAbsolute(raw, relativeTo, env)
    if (abs === undefined) return
    if (!isReadOnly && !isShell && isProtected(abs, protectedRoots, resolveReal)) blocked.add(abs)
    const bad = classify(abs, state, resolveReal)
    if (bad !== undefined) found.add(bad)
    // shell 读写受保护目录也要问一下（无法区分读和写）
    if (isShell && isProtected(abs, protectedRoots, resolveReal)) found.add(abs)
  }

  const scanText = (text, { posix = false, cd = false } = {}) => {
    const expanded = expandVars(text, env)
    for (const m of expanded.matchAll(PATH_LIKE)) check(m[0])
    if (posix) {
      for (const m of expanded.matchAll(POSIX_DRIVE)) {
        const win = posixToWindows(m[0])
        if (win !== undefined) check(win)
      }
    }
    if (cd) for (const m of expanded.matchAll(CD_COMMAND)) check(m[1], base)
  }

  const isScriptWrite = Object.entries(args).some(
    ([key, value]) => state.pathKeys.includes(key) && typeof value === 'string' && state.scriptExtensions.includes(extensionOf(value)),
  )

  walk(args, undefined, 0, (key, value) => {
    if (state.ignoreKeys.includes(key)) return
    if (state.pathKeys.includes(key)) {
      check(value)
    } else if (state.scanKeys.includes(key)) {
      if (isShell && key === 'command') {
        if (!state.scanShell) return
        scanText(value, { posix: true, cd: true })
        if (state.suspiciousCommands) {
          for (const [re, label] of SUSPICIOUS) if (re.test(value)) found.add('可疑操作 ' + label)
        }
      } else {
        scanText(value)
        // 相对的 glob 模式：..\..\秘密\**\*  → 按基准解析通配符之前的部分
        const prefix = globPrefix(value)
        if (prefix.split(/[\\/]/).includes('..')) check(prefix, base)
      }
    } else if (state.contentKeys.includes(key)) {
      if (isScriptWrite && state.scanScripts) scanText(value, { posix: true, cd: true })
    } else if (state.scanAllArgs) {
      scanText(value)
    }
  })

  result.found = [...found]
  result.blocked = [...blocked]
  return result
}

/** 兼容旧接口：返回所有问题（越界 + 受保护）。 */
export function collect(exec, state, resolveReal) {
  const { found, blocked } = inspect(exec, state, resolveReal)
  return [...new Set([...blocked, ...found])]
}

/** 放行（或交给用户审批）的切目录调用，更新相对路径基准。被拒绝的不更新。 */
function track(exec, state, decision) {
  if (decision && decision.kind === 'deny') return
  if (!state.cwdTools.includes(exec.name)) return
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return
  for (const key of ['cd', 'path', 'workdir', 'directory']) {
    const abs = toWindowsAbsolute(args[key], currentBase(state), envSource)
    if (abs !== undefined) {
      trackedCwd = abs
      return
    }
  }
}

/** 测试用：重置跟踪到的工作目录、提醒节流，并可替换环境变量。 */
export function _resetForTest(env) {
  trackedCwd = undefined
  lastAlertAt = 0
  if (env !== undefined) envSource = env
}

let lastAlertAt = 0

/** 触发提醒：声音 / 自定义通知窗 / 确认弹窗，三者各自独立进程，互不耦合。 */
function raiseAlert(state, toolName, detail) {
  const wantSound = state.alertSound !== false
  const wantCustom = state.alertCustom !== false
  const wantToast = state.alertToast === true
  const wantPopup = state.alertPopup !== false
  if (!wantSound && !wantCustom && !wantToast && !wantPopup) return

  const now = Date.now()
  if (now - lastAlertAt < state.alertCooldownMs) {
    logAlert('throttled tool=' + toolName + ' detail=' + detail)
    return
  }
  lastAlertAt = now

  const escape = (text) => String(text).replace(/'/g, "''")
  const message = escape('「' + toolName + '」想访问 ' + detail)
  const childLog = ALERT_LOG.replace(/'/g, "''")
  const jobs = []

  // 1) 声音：独立进程，阻塞播放，保证响
  if (wantSound) {
    jobs.push(
      [
        "try { (New-Object System.Media.SoundPlayer 'C:\\Windows\\Media\\Windows Ding.wav').PlaySync() } catch { try { [System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 800 } catch { } }",
      ].join("\r\n"),
    )
  }

  // 2) 自制通知窗：自绘窗口，无系统提示音，10 秒后自动关闭
  if (wantCustom) {
    jobs.push(
      [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$f = New-Object System.Windows.Forms.Form",
        "$f.FormBorderStyle = 'None'",
        "$f.StartPosition = 'Manual'",
        "$f.TopMost = $true",
        "$f.ShowInTaskbar = $false",
        "$f.BackColor = [System.Drawing.Color]::FromArgb(255, 249, 250, 255)",
        "$f.Size = New-Object System.Drawing.Size(360, 112)",
        "$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea",
        "$f.Location = New-Object System.Drawing.Point(($wa.Right - 384), ($wa.Bottom - 268))",
        "$r = New-Object System.Drawing.Drawing2D.GraphicsPath",
        "$r.AddArc(0,0,24,24,180,90); $r.AddArc(336,0,24,24,270,90); $r.AddArc(336,88,24,24,0,90); $r.AddArc(0,88,24,24,90,90); $r.CloseFigure()",
        "$f.Region = New-Object System.Drawing.Region -ArgumentList $r",
        "$bar = New-Object System.Windows.Forms.Panel",
        "$bar.Size = New-Object System.Drawing.Size(4, 56)",
        "$bar.Location = New-Object System.Drawing.Point(14, 28)",
        "$bar.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#F58BB0')",
        "$f.Controls.Add($bar)",
        "$t = New-Object System.Windows.Forms.Label",
        "$t.Text = '大肥鱼防窥眼罩'",
        "$t.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)",
        "$t.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#2C4470')",
        "$t.Location = New-Object System.Drawing.Point(26, 16)",
        "$t.Size = New-Object System.Drawing.Size(320, 24)",
        "$f.Controls.Add($t)",
        "$m = New-Object System.Windows.Forms.Label",
        "$m.Text = '" + message + "'",
        "$m.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)",
        "$m.ForeColor = [System.Drawing.ColorTranslator]::FromHtml('#33415C')",
        "$m.Location = New-Object System.Drawing.Point(26, 44)",
        "$m.Size = New-Object System.Drawing.Size(318, 52)",
        "$f.Controls.Add($m)",
        "$timer = New-Object System.Windows.Forms.Timer",
        "$timer.Interval = 10000",
        "$timer.Add_Tick({ $f.Close() })",
        "$timer.Start()",
        "$f.Add_Click({ $f.Close() })",
        "[void]$f.ShowDialog()",
      ].join("\r\n"),
    )
  }

  // 2.5) 系统气泡：Windows 原生托盘通知（自带提示音）
  if (wantToast) {
    jobs.push(
      [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$ni = New-Object System.Windows.Forms.NotifyIcon",
        "$ni.Icon = [System.Drawing.SystemIcons]::Warning",
        "$ni.Visible = $true",
        "$ni.BalloonTipTitle = 'Prevent-peep 警报'",
        "$ni.BalloonTipText = '" + message + "'",
        "$ni.ShowBalloonTip(10000)",
        "Start-Sleep -Seconds 10",
        "$ni.Dispose()",
      ].join("\r\n"),
    )
  }
  // 3) 确认弹窗：无图标，系统不会发声
  if (wantPopup) {
    jobs.push(
      [
        "Add-Type -AssemblyName System.Windows.Forms",
        "[System.Windows.Forms.MessageBox]::Show('" +
          message +
          "', 'Prevent-peep 警报', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::None) | Out-Null",
      ].join("\r\n"),
    )
  }

  logAlert('trigger tool=' + toolName + ' detail=' + detail + ' jobs=' + jobs.length)

  for (const script of jobs) {
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const child = spawn('cmd.exe', ['/c', 'start', '', POWERSHELL, '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', (error) => logAlert('spawn error: ' + String(error && error.message)))
      child.unref()
      logAlert('spawn pid=' + String(child.pid))
    } catch (error) {
      logAlert('alert failed: ' + String(error && error.message))
    }
  }
}
const ALERT_LOG = join(process.env.DSH_HOME ?? tmpdir(), 'prevent-peep-alert.log')
const POWERSHELL = process.env.SystemRoot
  ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe'

/** 诊断日志：失败也不影响主流程。 */
function logAlert(line) {
  try {
    appendFileSync(ALERT_LOG, new Date().toISOString() + ' ' + line + '\n')
  } catch {
    // 忽略
  }
}
export function apply(ctx, config) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    let report
    let state
    try {
      state = loadState(config)
      report = inspect(exec, state)
    } catch (error) {
      logAlert('guard error: ' + String(error && error.message))
      if (state !== undefined && state.failClosed) {
        return { kind: 'deny', reason: 'prevent-peep: guard error, blocked because failClosed is on' }
      }
      // 守卫自身出错时默认不阻断正常调用
      return next()
    }

    if (report.blocked.length > 0) {
      const detail = report.blocked.join(', ')
      raiseAlert(state, exec.name, detail)
      return {
        kind: 'deny',
        reason: `prevent-peep: "${exec.name}" tried to modify protected settings (${detail}).` + NO_WORKAROUND,
        displayReason: {
          en: `${BANNER_EN}"${exec.name}" tried to modify the plugin's or DSH's own settings (${detail}). Blocked.`,
          zh: `${BANNER_ZH}「${exec.name}」想修改插件或 DSH 自己的配置（${detail}），已拦截。`,
        },
      }
    }

    const found = report.found
    if (found.length === 0) {
      const decision = await next()
      track(exec, state, decision)
      return decision
    }

    const detail = found.join(', ')
    raiseAlert(state, exec.name, detail)
    const reason = `prevent-peep: "${exec.name}" targets ${detail}, outside the allowlist.` + NO_WORKAROUND

    if (state.mode === 'deny') {
      return { kind: 'deny', reason }
    }

    // 用户可能批准，按"已切换"处理：判错了只会多问，不会漏放
    track(exec, state, { kind: 'ask' })
    return {
      kind: 'ask',
      reason,
      displayReason: {
        en: `${BANNER_EN}"${exec.name}" wants ${detail}, which is not allowed. Allow this once?`,
        zh: `${BANNER_ZH}「${exec.name}」要访问 ${detail}，不在白名单内。只允许这一次？`,
      },
    }
  })
}

export { STATE_FILE }
