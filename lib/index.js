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
 * - 只检查工具参数里的路径字符串；`pwsh` 里运行时拼接的路径无法可靠识别，
 *   因此对 shell 仅做"命令串包含受管根字样"的启发式检查（可能误报）。
 * - 相对路径只在其包含 `..` 时按 relativeBase 解析；普通相对路径视为在工作区内。
 *
 * @module prevent-peep
 */

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { loadState, STATE_FILE } from './state.js'

export const name = 'prevent-peep'
export const inject = ['tools']

/** 审批提示前缀。 */
const BANNER_ZH = '大肥鱼安全助手提醒您：'
const BANNER_EN = 'Big Fat Fish Security Assistant reminds you: '

function isAbsolutePath(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
}

function normalizeLower(value) {
  try {
    return String(value).replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
  } catch {
    return ''
  }
}

function isUnder(normalizedPath, root) {
  if (normalizedPath === '' || root === '') return false
  return normalizedPath === root || normalizedPath.startsWith(root + '\\')
}

/** 命令串里是否真的出现了某个根（避免 "d:" 命中 "d:x" 这类误报）。 */
function mentionsRoot(command, root) {
  const at = command.indexOf(root)
  if (at < 0) return false
  const next = command[at + root.length]
  return next === undefined || next === '\\'
}

/**
 * 判定一个路径是否越界：黑名单 > 白名单 > 受管根。
 * @returns 越界的绝对路径；允许或无法判定时返回 undefined。
 */
function violation(raw, state) {
  if (typeof raw !== 'string') return undefined
  const p = raw.trim()
  if (p === '') return undefined

  let target
  if (isAbsolutePath(p)) {
    target = p
  } else if (p.split(/[\\/]/).includes('..') && state.relativeBase !== undefined) {
    target = resolve(state.relativeBase, p)
  } else {
    return undefined
  }

  const norm = normalizeLower(target)
  if (state.denyRoots.some((root) => isUnder(norm, root))) return target
  if (state.allowRoots.some((root) => isUnder(norm, root))) return undefined
  if (state.enforceRoots.some((root) => isUnder(norm, root))) return target
  return undefined
}

function collect(exec, state) {
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return []
  const found = []

  for (const key of state.pathKeys) {
    const value = args[key]
    if (typeof value === 'string') {
      const bad = violation(value, state)
      if (bad !== undefined) found.push(bad)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        const bad = violation(item, state)
        if (bad !== undefined) found.push(bad)
      }
    }
  }

  // shell 启发式：命令串里出现受管根字样时要求确认（无法静态拆解任意代码）
  if (state.scanShell && exec.name === 'pwsh' && typeof args.command === 'string') {
    const command = args.command.toLowerCase()
    const explicitlyAllowed = state.allowRoots.some((root) => mentionsRoot(command, root))
    if (!explicitlyAllowed) {
      for (const root of state.enforceRoots) {
        if (mentionsRoot(command, root)) {
          found.push(`shell mentions ${root}`)
          break
        }
      }
    }
  }

  return [...new Set(found)]
}

/** 触发提醒：声音与气泡同时出现，可选确认弹窗。失败静默，不影响拦截判定。 */
function raiseAlert(state, toolName, detail) {
  const wantSound = state.alertSound !== false
  const wantToast = state.alertToast !== false
  const wantPopup = state.alertPopup !== false
  if (!wantSound && !wantToast && !wantPopup) return

  const escape = (text) => String(text).replace(/'/g, "''")
  const message = escape('「' + toolName + '」想访问 ' + detail)
  const childLog = ALERT_LOG.replace(/'/g, "''")
  const parts = [
    "try { Add-Content -LiteralPath '" + childLog + "' -Value ((Get-Date -Format o) + ' child-boot pid=' + $PID) -Encoding UTF8 } catch { }",
  ]

  // 声音：有气泡/弹窗时异步播放（与它们同时出现）；
  // 只有声音时必须阻塞播放，否则进程退出会把声音掐断。
  if (wantSound) {
    if (!wantToast && !wantPopup) {
      parts.push(
        "try { $player = New-Object System.Media.SoundPlayer 'C:\\Windows\\Media\\Windows Ding.wav'; $player.PlaySync() } catch { try { [System.Media.SystemSounds]::Exclamation.Play(); Start-Sleep -Milliseconds 800 } catch { } }",
      )
    } else {
      parts.push(
        "try { $player = New-Object System.Media.SoundPlayer 'C:\\Windows\\Media\\Windows Ding.wav'; $player.Play() } catch { try { [System.Media.SystemSounds]::Exclamation.Play() } catch { } }",
      )
    }
  }

  // 气泡：只显示，不阻塞
  if (wantToast) {
    parts.push(
      "try { Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $ni = New-Object System.Windows.Forms.NotifyIcon; $ni.Icon = [System.Drawing.SystemIcons]::Warning; $ni.Visible = $true; $ni.BalloonTipTitle = 'Prevent-peep 警报'; $ni.BalloonTipText = '" +
        message +
        "'; $ni.ShowBalloonTip(10000) } catch { }",
    )
  }

  // 确认弹窗：阻塞直到点确定
  if (wantPopup) {
    parts.push(
      "try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('" +
        message +
        "', 'Prevent-peep 警报', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::None) | Out-Null } catch { }",
    )
  } else if (wantToast) {
    // 没有确认弹窗时，保活到气泡消失
    parts.push('Start-Sleep -Seconds 10')
  }

  if (wantToast) {
    parts.push("try { if ($ni) { $ni.Dispose() } } catch { }")
  }

  logAlert('trigger tool=' + toolName + ' detail=' + detail)

  const script = parts.join("\r\n")
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
    } catch {
      // 守卫自身出错时不阻断正常调用
      return next()
    }
    if (found.length === 0) return next()

    const detail = found.join(', ')
    raiseAlert(state, exec.name, detail)
    const reason = `prevent-peep: "${exec.name}" targets ${detail}, outside the allowlist`

    if (state.mode === 'deny') {
      return { kind: 'deny', reason }
    }

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
