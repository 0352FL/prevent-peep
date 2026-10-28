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
import { join } from 'node:path'
import { normRoot } from './paths.js'

export { normRoot }

/** 状态文件的绝对路径。DSH_HOME 未设置时回退到 ~/.dsh。 */
export const STATE_FILE = join(
  process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  'prevent-peep.json',
)

/**
 * 没有状态文件、也没有配置时使用的默认值。
 * 名单默认为空：装好后先打开管理窗口选目录，守卫才开始管事。
 */
export const DEFAULTS = Object.freeze({
  mode: 'ask',
  enforceRoots: [],
  allowRoots: [],
  denyRoots: [],
  scanShell: true,
  relativeBase: undefined,
  /** 这些参数整个当作路径来判定 */
  pathKeys: ['file_path', 'file_paths', 'path', 'paths', 'image_path', 'workdir', 'cwd', 'cd', 'dir', 'directory'],
  /** 这些参数里搜"像绝对路径的片段"（glob 模式、shell 命令等） */
  scanKeys: ['pattern', 'glob', 'include', 'exclude', 'command'],
  /** 视为 shell 的工具；scanShell 关掉时不扫它们的 command */
  shellTools: ['pwsh', 'powershell', 'bash', 'sh', 'shell', 'cmd'],
  /** 会改变工作目录的工具，用来跟踪相对路径的基准 */
  cwdTools: ['working_directory'],
  /** 守卫自身出错时：false 放行（默认），true 拒绝 */
  failClosed: false,
  /** 两次提醒之间至少间隔多少毫秒，防止弹窗刷屏 */
  alertCooldownMs: 5000,
  alertSound: true,
  alertCustom: true,
  alertToast: false,
  alertPopup: true,
})

function roots(list) {
  if (!Array.isArray(list)) return []
  return list.map(normRoot).filter(Boolean)
}

function strings(list, fallback) {
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : fallback
}

/** 合并默认值、插件配置与状态文件（状态文件优先级最高）。 */
export function mergeState(config, state) {
  const merged = { ...DEFAULTS, ...(config ?? {}), ...(state ?? {}) }
  const cooldown = Number(merged.alertCooldownMs)
  return {
    mode: merged.mode === 'deny' ? 'deny' : 'ask',
    enforceRoots: roots(merged.enforceRoots),
    allowRoots: roots(merged.allowRoots),
    denyRoots: roots(merged.denyRoots),
    scanShell: merged.scanShell !== false,
    relativeBase:
      typeof merged.relativeBase === 'string' && merged.relativeBase.trim() !== ''
        ? merged.relativeBase
        : undefined,
    pathKeys: strings(merged.pathKeys, DEFAULTS.pathKeys),
    scanKeys: strings(merged.scanKeys, DEFAULTS.scanKeys),
    shellTools: strings(merged.shellTools, DEFAULTS.shellTools),
    cwdTools: strings(merged.cwdTools, DEFAULTS.cwdTools),
    failClosed: merged.failClosed === true,
    alertCooldownMs: Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : DEFAULTS.alertCooldownMs,
    alertSound: merged.alertSound !== false,
    alertCustom: merged.alertCustom !== false,
    alertToast: merged.alertToast === true,
    alertPopup: merged.alertPopup !== false,
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
      state = JSON.parse(raw.replace(/^﻿/, ''))
    } catch {
      state = undefined
    }
  }
  const value = mergeState(config, state)
  cache = { at: now, value }
  return value
}
