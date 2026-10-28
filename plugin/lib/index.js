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
import { tmpdir } from 'node:os'
import { loadState, STATE_FILE } from './state.js'
import { PATH_LIKE, classify, toWindowsAbsolute } from './paths.js'

export const name = 'prevent-peep'
export const inject = ['tools']

/** 审批提示前缀。 */
const BANNER_ZH = '大肥鱼安全助手提醒您：'
const BANNER_EN = 'Big Fat Fish Security Assistant reminds you: '

/** 通过 working_directory 等工具跟踪到的当前工作目录（启发式，所有会话共用）。 */
let trackedCwd

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

/**
 * 收集一次工具调用里所有越界的路径。
 * - pathKeys 里的参数：整体当作路径解析后判定
 * - scanKeys 里的参数：提取"像绝对路径"的片段逐个判定（glob 模式、shell 命令）
 */
export function collect(exec, state, resolveReal) {
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return []
  const base = currentBase(state)
  const isShell = state.shellTools.includes(exec.name)
  const found = new Set()

  const check = (raw) => {
    const abs = toWindowsAbsolute(raw, base)
    if (abs === undefined) return
    const bad = classify(abs, state, resolveReal)
    if (bad !== undefined) found.add(bad)
  }

  walk(args, undefined, 0, (key, value) => {
    if (state.pathKeys.includes(key)) {
      check(value)
    } else if (state.scanKeys.includes(key) && (!isShell || state.scanShell)) {
      for (const match of value.matchAll(PATH_LIKE)) check(match[0])
    }
  })

  return [...found]
}

/** 放行（或交给用户审批）的切目录调用，更新相对路径基准。被拒绝的不更新。 */
function track(exec, state, decision) {
  if (decision && decision.kind === 'deny') return
  if (!state.cwdTools.includes(exec.name)) return
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return
  for (const key of ['cd', 'path', 'workdir', 'directory']) {
    const abs = toWindowsAbsolute(args[key], currentBase(state))
    if (abs !== undefined) {
      trackedCwd = abs
      return
    }
  }
}

/** 测试用：重置跟踪到的工作目录和提醒节流。 */
export function _resetForTest() {
  trackedCwd = undefined
  lastAlertAt = 0
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
    let found
    let state
    try {
      state = loadState(config)
      found = collect(exec, state)
    } catch (error) {
      logAlert('guard error: ' + String(error && error.message))
      if (state !== undefined && state.failClosed) {
        return { kind: 'deny', reason: 'prevent-peep: guard error, blocked because failClosed is on' }
      }
      // 守卫自身出错时默认不阻断正常调用
      return next()
    }
    if (found.length === 0) {
      const decision = await next()
      track(exec, state, decision)
      return decision
    }

    const detail = found.join(', ')
    raiseAlert(state, exec.name, detail)
    const reason = `prevent-peep: "${exec.name}" targets ${detail}, outside the allowlist`

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
