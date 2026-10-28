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
  /** 写这些扩展名的文件时，也扫描写入内容里的路径（先写脚本再运行，是最常见的绕法） */
  scriptExtensions: ['.py', '.ps1', '.psm1', '.bat', '.cmd', '.sh', '.bash', '.js', '.mjs', '.cjs', '.ts', '.vbs'],
  /** 关掉后不扫脚本内容（开发本插件、改测试文件时会频繁提示，可以临时关） */
  scanScripts: true,
  /** 写入内容所在的参数名 */
  contentKeys: ['content', 'contents', 'new_string', 'new_str', 'text', 'code'],
  /** 完全不检查的参数（编辑前的旧内容，不构成新风险） */
  ignoreKeys: ['old_string', 'old_str'],
  /** 其余参数（不在上面任何名单里的）也兜底搜一遍绝对路径，防止别的插件 / MCP 工具换了参数名 */
  scanAllArgs: true,
  /** shell 里出现建链接、建盘符、编码命令、卸插件这类操作时要求确认 */
  suspiciousCommands: true,
  /** 只读工具：可以读受保护目录（插件配置、DSH 配置） */
  readOnlyTools: ['read', 'glob', 'grep', 'read_image', 'present', 'working_directory', 'ls', 'list', 'view'],
  /** 保护 $DSH_HOME（含本插件配置、DSH 设置）：非只读工具一律拒绝写入（不受 mode 影响） */
  selfProtect: true,
  /** 连插件自己的代码目录也保护起来。默认关：用 DSH 开发本插件时会被拦 */
  protectPluginDir: false,
  /** 额外的受保护目录 */
  protectedRoots: [],
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
    scriptExtensions: strings(merged.scriptExtensions, DEFAULTS.scriptExtensions).map((x) => x.toLowerCase()),
    scanScripts: merged.scanScripts !== false,
    contentKeys: strings(merged.contentKeys, DEFAULTS.contentKeys),
    ignoreKeys: strings(merged.ignoreKeys, DEFAULTS.ignoreKeys),
    scanAllArgs: merged.scanAllArgs !== false,
    suspiciousCommands: merged.suspiciousCommands !== false,
    readOnlyTools: strings(merged.readOnlyTools, DEFAULTS.readOnlyTools),
    selfProtect: merged.selfProtect !== false,
    protectPluginDir: merged.protectPluginDir === true,
    protectedRoots: roots(merged.protectedRoots),
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
