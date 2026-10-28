/**
 * 路径规范化与判定（纯函数，按 Windows 规则处理，在任何系统上测试结果一致）。
 *
 * 之前的版本只做字符串前缀比较，导致这些写法能绕过：
 *   D:\TE_Code\..\秘密     绝对路径里的 .. 没有解析
 *   \\?\D:\秘密            长路径前缀
 *   \\localhost\D$\秘密    本机管理共享
 *   D:秘密                 盘符相对路径（没有斜杠）
 * 现在一律先解析成规范的绝对路径，再和名单比较。
 *
 * @module prevent-peep/paths
 */

import { realpathSync } from 'node:fs'
import { win32 } from 'node:path'

/** 命令串 / glob 模式里"看起来像绝对路径"的片段。 */
export const PATH_LIKE =
  /(?<![\w])(?:\\\\[?.]\\)?[a-z]:(?:[\\/][^\s'"`;|&<>(),]*|(?=[\s'"`;|&<>(),]|$))|\\\\[^\s'"`;|&<>(),\\/]+[\\/][^\s'"`;|&<>(),]*/gi

/** 去掉引号、统一分隔符、剥掉 \\?\ \\.\ 和本机管理共享前缀。 */
function strip(raw) {
  let p = String(raw).trim().replace(/^["']+|["']+$/g, '').replace(/\//g, '\\')
  p = p.replace(/^\\\\[?.]\\UNC\\/i, '\\\\')
  p = p.replace(/^\\\\[?.]\\(?=[a-z]:)/i, '')
  p = p.replace(/^\\\\(?:localhost|127\.0\.0\.1|\[?::1\]?)\\([a-z])\$(?=\\|$)/i, '$1:')
  return p
}

/**
 * 把工具参数里的路径解析成规范的 Windows 绝对路径。
 * - 绝对路径：解析 . 与 ..
 * - 盘符相对（D: / D:foo）：保守地按盘符根处理
 * - 根相对（\foo）：用 base 所在盘符
 * - 普通相对路径：有 base 时按 base 解析，没有 base 时无法判定（返回 undefined）
 */
export function toWindowsAbsolute(raw, base) {
  if (typeof raw !== 'string') return undefined
  let p = strip(raw)
  if (p === '') return undefined
  if (/^[a-z]:(?!\\)/i.test(p)) p = p.slice(0, 2) + '\\' + p.slice(2)
  if (/^[a-z]:\\/i.test(p) || p.startsWith('\\\\')) return win32.resolve(p)
  if (base === undefined) return undefined
  const baseAbs = toWindowsAbsolute(base, undefined)
  if (baseAbs === undefined) return undefined
  if (p.startsWith('\\')) return win32.resolve(win32.parse(baseAbs).root, p.slice(1))
  return win32.resolve(baseAbs, p)
}

/** 比较用的键：小写、去掉末尾分隔符。 */
export function keyOf(absPath) {
  return absPath.replace(/\\+$/, '').toLowerCase()
}

/** 名单里的根目录：只接受绝对路径，其余丢弃。 */
export function normRoot(value) {
  try {
    const abs = toWindowsAbsolute(String(value), undefined)
    return abs === undefined ? '' : keyOf(abs)
  } catch {
    return ''
  }
}

export function isUnder(key, root) {
  if (key === '' || root === '') return false
  return key === root || key.startsWith(root + '\\')
}

/**
 * 解析符号链接 / 目录联接 / 8.3 短文件名：
 * 对"最深的已存在祖先目录"取真实路径，再拼回剩下的部分。仅在 Windows 上生效。
 */
export function realish(absPath) {
  if (process.platform !== 'win32') return absPath
  let head = absPath
  const tail = []
  for (let i = 0; i < 128; i++) {
    try {
      const real = realpathSync.native(head)
      return tail.length === 0 ? real : win32.join(real, ...tail.reverse())
    } catch {
      const parent = win32.dirname(head)
      if (parent === head) return absPath
      tail.push(win32.basename(head))
      head = parent
    }
  }
  return absPath
}

/**
 * 判定：黑名单 > 白名单 > 受管根。字面路径和真实路径只要有一个越界就算越界。
 * @returns 越界的路径；允许时返回 undefined。
 */
export function classify(absPath, state, resolveReal = realish) {
  const candidates = new Set([absPath, resolveReal(absPath)])
  for (const candidate of candidates) {
    const key = keyOf(candidate)
    if (state.denyRoots.some((root) => isUnder(key, root))) return candidate
    if (state.allowRoots.some((root) => isUnder(key, root))) continue
    if (state.enforceRoots.some((root) => isUnder(key, root))) return candidate
  }
  return undefined
}
