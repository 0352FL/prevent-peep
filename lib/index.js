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

/** 触发提醒：系统提示音 + Windows 通知（失败静默，绝不影响判定）。 */
function raiseAlert(state, toolName, detail) {
  if (state.alertSound === false && state.alertToast === false) return

  const message = `「${toolName}」想访问 ${detail}`
  const lines = []
  if (state.alertSound !== false) {
    lines.push('[System.Media.SystemSounds]::Exclamation.Play()')
  }
  if (state.alertToast !== false) {
    lines.push(`
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $tpl = '<toast duration="short"><visual><binding template="ToastGeneric"><text>Prevent-peep 警报</text><text>${message}</text></binding></visual><audio src="ms-winsoundevent:Notification.Looping.Alarm" /></toast>'
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml($tpl)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch { }
`.trim())
  }

  const script = lines.join("`r`n")
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    // 提醒失败不影响拦截
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
