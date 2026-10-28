/**
 * 路径规范化与判定（纯函数，按 Windows 规则处理，在任何系统上测试结果一致）。
 *
 * 一律先把各种写法解析成规范的 Windows 绝对路径，再和名单比较：
 *   D:\TE_Code\..\秘密            绝对路径里的 ..
 *   \\?\D:\秘密  \\.\D:\秘密       长路径 / 设备前缀
 *   \\任意主机\D$\秘密             管理共享（保守地按本机 D 盘处理）
 *   \\wsl$\发行版\mnt\d\秘密       WSL 访问 Windows 盘
 *   /mnt/d/秘密  /cygdrive/d/秘密  WSL / Cygwin 风格
 *   file:///D:/秘密                file URI
 *   D:秘密                         盘符相对路径
 *   D:\秘密.\  D:\秘密 \           Windows 会忽略的尾随点和空格
 *   ~\  %USERPROFILE%  $env:X      环境变量（按当前进程的真实值展开）
 * 换算不成盘符的设备路径（\\?\Volume{…}、\\?\GLOBALROOT\…）一律按越界处理。
 *
 * @module prevent-peep/paths
 */

import { realpathSync } from 'node:fs'
import { win32 } from 'node:path'

const STOP = `\\s'"\`;|&<>(),`

/** 命令串 / glob 模式里"看起来像 Windows 绝对路径"的片段。 */
export const PATH_LIKE = new RegExp(
  `(?<![\\w])(?:\\\\\\\\[?.]\\\\)?[a-z]:(?:[\\\\/][^${STOP}]*|(?=[${STOP}]|$))` +
    `|\\\\\\\\[^${STOP}\\\\/]+[\\\\/][^${STOP}]*` +
    `|(?<![\\w])file:\\/\\/[^${STOP}]+`,
  'gi',
)

/** shell 命令里的 WSL / Cygwin / Git Bash 盘符写法：/mnt/d/…、/cygdrive/d/…、/d/… */
export const POSIX_DRIVE = new RegExp(
  `(?<![\\w.~/\\\\-])\\/(?:(?:mnt|cygdrive)\\/[a-z](?=\\/|$|[${STOP}])|[a-z]\\/)[^${STOP}]*`,
  'gi',
)

/** shell 里切换目录的命令，捕获目标路径。 */
export const CD_COMMAND =
  /(?:^|[;&|\n{(]|\s)(?:cd|chdir|sl|set-location|pushd|push-location)(?:\s+\/d)?(?:\s+-(?:literalpath|path|lp))?\s+("[^"]*"|'[^']*'|[^\s;&|)}]+)/gi

/** 把 /mnt/d/x、/cygdrive/d/x、/d/x 换算成 D:\x。 */
export function posixToWindows(text) {
  const m = /^\/(?:(?:mnt|cygdrive)\/)?([a-z])(\/.*)?$/i.exec(text)
  if (!m) return undefined
  return m[1].toUpperCase() + ':' + (m[2] ?? '\\').replace(/\//g, '\\')
}

function lookup(env, name) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/** 展开 %VAR%、$env:VAR、${env:VAR}、$HOME、~。查不到的变量原样保留。 */
export function expandVars(text, env = process.env) {
  let out = String(text)
  const home = lookup(env, 'USERPROFILE') ?? lookup(env, 'HOME')
  out = out.replace(/%([A-Za-z_][\w()]*)%/g, (m, n) => lookup(env, n) ?? m)
  out = out.replace(/\$\{env:([A-Za-z_][\w()]*)\}/gi, (m, n) => lookup(env, n) ?? m)
  out = out.replace(/\$env:([A-Za-z_]\w*)/gi, (m, n) => lookup(env, n) ?? m)
  if (home !== undefined) {
    out = out.replace(/\$\{HOME\}|\$HOME(?![\w])/g, home)
    out = out.replace(/(^|[\s'"(=,;])~(?=[\\/]|$|[\s'"),;])/g, (m, pre) => pre + home)
  }
  return out
}

/** 去掉引号、统一分隔符，把各种等价写法换算成普通的盘符 / UNC 路径。 */
function strip(raw) {
  let p = String(raw).trim().replace(/^["']+|["']+$/g, '')
  const localUri = /^file:\/\/(?:localhost)?\/(?=[a-z]:)/i
  if (localUri.test(p)) {
    p = p.replace(localUri, '')
    try { p = decodeURIComponent(p) } catch { /* 保持原样 */ }
  } else if (/^file:\/\/[^/]+\//i.test(p)) {
    p = '\\\\' + p.slice('file://'.length)
    try { p = decodeURIComponent(p) } catch { /* 保持原样 */ }
  }
  p = p.replace(/\//g, '\\')
  p = p.replace(/^\\(?:mnt|cygdrive)\\([a-z])(?=\\|$)/i, '$1:')
  p = p.replace(/^\\\\[?.]\\UNC\\/i, '\\\\')
  p = p.replace(/^\\\\[?.]\\(?=[a-z]:)/i, '')
  p = p.replace(/^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+\\mnt\\([a-z])(?=\\|$)/i, '$1:')
  // 任意主机的管理共享 \\主机\D$ 都按本机 D 盘处理：插件无法判断主机名是不是本机，宁可多问
  p = p.replace(/^\\\\[^\\]+\\([a-z])\$(?=\\|$)/i, '$1:')
  return p
}

/** 换算不成盘符的设备命名空间路径（\\?\Volume{…}、\\?\GLOBALROOT\…、\\.\…）。 */
const DEVICE_PATH = /^\\\\[?.]\\/

/**
 * Windows 会忽略每段路径末尾的点和空格：
 * `D:\2学习.\a` 打开的就是 `D:\2学习\a`。逐段剥掉，但保留 `.` 与 `..`。
 */
function trimSegmentDots(p) {
  return p
    .split('\\')
    .map((seg) => {
      if (seg === '' || seg === '.' || seg === '..') return seg
      const trimmed = seg.replace(/[. ]+$/, '')
      return trimmed === '' ? seg : trimmed
    })
    .join('\\')
}

/**
 * 把工具参数里的路径解析成规范的 Windows 绝对路径。
 * - 绝对路径：解析 . 与 ..
 * - 盘符相对（D: / D:foo）：保守地按盘符根处理
 * - 根相对（\foo）：用 base 所在盘符
 * - 普通相对路径：有 base 时按 base 解析，没有 base 时无法判定（返回 undefined）
 * @param env 传入时先展开环境变量和 ~
 */
export function toWindowsAbsolute(raw, base, env) {
  if (typeof raw !== 'string') return undefined
  let p = strip(env === undefined ? raw : expandVars(raw, env))
  if (p === '') return undefined
  if (/^[a-z]:(?!\\)/i.test(p)) p = p.slice(0, 2) + '\\' + p.slice(2)
  if (/^[a-z]:\\/i.test(p) || p.startsWith('\\\\')) return win32.resolve(trimSegmentDots(p))
  if (base === undefined) return undefined
  const baseAbs = toWindowsAbsolute(base, undefined, env)
  if (baseAbs === undefined) return undefined
  if (p.startsWith('\\')) return win32.resolve(win32.parse(baseAbs).root, trimSegmentDots(p).slice(1))
  return win32.resolve(baseAbs, trimSegmentDots(p))
}

/** glob 模式里第一个通配符之前的目录部分，例如 ..\..\秘密\**\*.txt → ..\..\秘密 */
export function globPrefix(pattern) {
  const parts = String(pattern).replace(/\//g, '\\').split('\\')
  const fixed = []
  for (const part of parts) {
    if (/[*?[\]{}]/.test(part)) break
    fixed.push(part)
  }
  return fixed.length === parts.length ? fixed.slice(0, -1).join('\\') : fixed.join('\\')
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

/** 字面路径和真实路径（去重）。 */
export function candidatesOf(absPath, resolveReal = realish) {
  return [...new Set([absPath, resolveReal(absPath)])]
}

/**
 * 判定：黑名单 > 白名单 > 受管根 > 设备路径。字面路径和真实路径只要有一个越界就算越界。
 * 设备路径只在用户配置了名单之后才拦，没配置时插件什么都不管。
 * @returns 越界的路径；允许时返回 undefined。
 */
export function classify(absPath, state, resolveReal = realish) {
  const configured = state.enforceRoots.length > 0 || state.denyRoots.length > 0
  for (const candidate of candidatesOf(absPath, resolveReal)) {
    const key = keyOf(candidate)
    if (state.denyRoots.some((root) => isUnder(key, root))) return candidate
    if (state.allowRoots.some((root) => isUnder(key, root))) continue
    if (state.enforceRoots.some((root) => isUnder(key, root))) return candidate
    if (configured && DEVICE_PATH.test(key)) return candidate
  }
  return undefined
}

/** 是否落在受保护目录（插件自己、DSH 配置目录）里。 */
export function isProtected(absPath, protectedRoots, resolveReal = realish) {
  return candidatesOf(absPath, resolveReal).some((candidate) =>
    protectedRoots.some((root) => isUnder(keyOf(candidate), root)),
  )
}
