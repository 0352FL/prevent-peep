/**
 * 全局状态：$DSH_HOME/prevent-peep.json
 *
 * 该文件由 tools/manage.ps1（大肥鱼我真该控制你了！.cmd）与守卫本身共同使用。
 * 读取带 1 秒缓存，因此保存后几乎立即生效，不需要重启 DSH。
 *
 * @module prevent-peep/state
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

/** 状态文件的绝对路径。DSH_HOME 未设置时回退到 ~/.dsh。 */
export const STATE_FILE = join(
  process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  'prevent-peep.json',
)

/** 没有状态文件、也没有配置时使用的默认值。 */
export const DEFAULTS = Object.freeze({
  mode: 'ask',
  enforceRoots: ['D:\\'],
  allowRoots: ['D:\\TE_Code', 'D:\\DSH'],
  denyRoots: [],
  scanShell: true,
  relativeBase: undefined,
  pathKeys: ['file_path', 'path', 'paths', 'workdir', 'cd'],
  alertSound: true,
  alertToast: true,
})

/** 规范化根路径：解析 . 与 ..，去掉末尾分隔符，统一小写（Windows 不区分大小写）。 */
export function normRoot(value) {
  try {
    return normalize(String(value)).replace(/[\\/]+$/, '').toLowerCase()
  } catch {
    return ''
  }
}

function roots(list) {
  if (!Array.isArray(list)) return []
  return list.map(normRoot).filter(Boolean)
}

/** 合并默认值、插件配置与状态文件（状态文件优先级最高）。 */
export function mergeState(config, state) {
  const merged = { ...DEFAULTS, ...(config ?? {}), ...(state ?? {}) }
  return {
    mode: merged.mode === 'deny' ? 'deny' : 'ask',
    enforceRoots: roots(merged.enforceRoots),
    allowRoots: roots(merged.allowRoots),
    denyRoots: roots(merged.denyRoots),
    scanShell: merged.scanShell !== false,
    relativeBase: typeof merged.relativeBase === 'string' ? merged.relativeBase : undefined,
    pathKeys: Array.isArray(merged.pathKeys) ? merged.pathKeys : DEFAULTS.pathKeys,
    alertSound: merged.alertSound !== false,
    alertToast: merged.alertToast !== false,
  }
}

let cache = { at: 0, value: undefined }

/** 读取并合并当前状态；文件解析失败时退回默认值。 */
export function loadState(config) {
  const now = Date.now()
  if (cache.value !== undefined && now - cache.at < 1000) return cache.value

  let raw
  try {
    raw = readFileSync(STATE_FILE, 'utf8')
  } catch {
    raw = undefined
  }
  let state
  if (raw !== undefined) {
    try {
      state = JSON.parse(raw.replace(/^\uFEFF/, ''))
    } catch {
      state = undefined
    }
  }
  const value = mergeState(config, state)
  cache = { at: now, value }
  return value
}
