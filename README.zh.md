# 🐟 Prevent-peep · 大肥鱼文件夹防窥眼罩

[English](README.md) | [简体中文](README.zh.md) | [更新日志](CHANGELOG.md)

[![DeepSeek Harness Plugin](https://deepseekharnessplugins.com/api/badge/0352FL/prevent-peep)](https://deepseekharnessplugins.com/plugins/0352FL/prevent-peep)

> 🐟 大肥鱼瞎逛的时候，别让它看见不该看的，更别顺手传到云端。
> 😏 顺便防止梁圣拿你的文件夹列表嘲讽你的 XP。

给 DeepSeek Harness 戴的一副"眼罩"：智能体每次想读文件，都得先过一道闸。放不放行，你说了算。

## 🛡️ 它到底干嘛

一个窗口，三份名单，四种提醒：

| 名单 | 规矩 |
| --- | --- |
| ✅ 白名单 | 永远放行 |
| 🚫 黑名单 | 永远盘问（优先级最高） |
| 📁 受管根 | 只有这些目录下的路径才管 |

命中之后，四种提醒随便配：**🔔 叮一声**、**🪟 右下角自制通知窗**、**💬 Windows 原生气泡**、**⚠️ 必须点确认的弹窗**。

再加一个原生"选择文件夹"对话框——不用手打路径。改完自动保存，1 秒生效，不用重启。

## ⚠️ 先说清楚：这是软锁，不是保险箱

挡得住手滑和顺手看一眼，挡不住铁了心要翻的人：

- 🧱 拦的是 **DSH 的工具调用**，不是操作系统
- 🪄 `pwsh` 里现场拼出来的路径（`"D:" + "\秘密"`）它看不出来
- 🚪 绕过 DSH 直接读磁盘、换个工具、或者你自己点"允许"，它都管不着

真要"谁都看不见"，请上 **ACL / 加密容器 / 独立 Windows 账户**——那才叫硬锁。
这插件只是把"随手翻一下"的成本抬高了一点点。

## 📦 安装

需要带 `desktop` 或 `web` profile 的 DSH。两个包都要装：`bundle` 是组合包（插件页显示的那个），`plugin` 是本体。

```sh
git clone https://github.com/0352FL/prevent-peep
dsh plugin --profile desktop add "<路径>/prevent-peep/bundle"
dsh plugin --profile desktop add "<路径>/prevent-peep/plugin"
```

装完重启一次 DSH 🔄

## 🎛️ 用起来

双击 `plugin/大肥鱼我真该控制你了！.cmd`，剩下的看界面就行。名单默认是空的，**至少选一个受管根**，守卫才开始干活。

配置存在 `%USERPROFILE%\.dsh\prevent-peep.json`：

```json
{
  "mode": "ask",
  "enforceRoots": ["D:\\"],
  "allowRoots": ["D:\\TE_Code", "D:\\DSH"],
  "denyRoots": [],
  "scanShell": true,
  "alertSound": true,
  "alertCustom": true,
  "alertToast": false,
  "alertPopup": true,
  "relativeBase": "C:\\Users\\TE\\Documents\\deepseek-harness\\default-workspace"
}
```

| 字段 | 含义 |
| --- | --- |
| `mode` | `ask` 弹审批卡片，`deny` 直接拒绝 |
| `allowRoots` | 永远放行 |
| `denyRoots` | 永远盘问（最高优先级） |
| `enforceRoots` | 只管这些目录下的路径 |
| `scanShell` | 连 shell 命令里像路径的片段一起扫 |
| `relativeBase` | 相对路径的基准（不填就用最近一次 `working_directory`） |
| `alertSound` | 🔔 叮一声 |
| `alertCustom` | 🪟 自制无声通知窗 |
| `alertToast` | 💬 Windows 原生气泡（自带系统音） |
| `alertPopup` | ⚠️ 必须点确认的弹窗 |

判定顺序：**黑名单 → 白名单 → 受管根**。判定前会先把路径彻底解析干净（`..`、`\\?\`、`\\localhost\D$`、`D:foo`、正反斜杠、大小写），在 Windows 上还会顺着符号链接 / 目录联接 / 8.3 短文件名找到真实路径——字面路径和真实路径**有一个越界就算越界**。

高级选项（窗口里没有，但点「保存」时会原样保留）：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `failClosed` | `false` | 守卫自己出错时：`false` 放行，`true` 拒绝 |
| `alertCooldownMs` | `5000` | 两次提醒的最小间隔，防止智能体连环试探刷屏 |
| `pathKeys` | `file_path`、`path`、`paths`、`workdir`、`cd` 等 | 整个当作路径判定的参数 |
| `scanKeys` | `pattern`、`glob`、`include`、`exclude`、`command` | 在里面搜绝对路径片段的参数 |
| `shellTools` | `pwsh`、`powershell`、`bash`、`sh`、`shell`、`cmd` | `command` 受 `scanShell` 控制的工具 |
| `cwdTools` | `working_directory` | 它切到的目录会成为相对路径基准 |

## 👀 它能看见哪些操作

参数里带路径（`pathKeys`）或带绝对路径片段（`scanKeys`）的工具调用都会检查，实际上就是 `read`、`write`、`edit`、`glob`（含 `pattern`）、`grep`、`read_image`、`present`、`working_directory`，以及 `pwsh`（`workdir` 和命令本身）。让它写入的**文件内容**不会被扫描。

## 🧠 一点良心话

- 🪄 shell 的检查是**启发式**：从命令里挑出像路径的片段来判。拼字符串、环境变量、先 `cd D:` 再在下一条命令里用相对路径，还是能绕
- 📐 相对路径需要基准：`relativeBase`，或者守卫看到的最近一次 `working_directory`（所有会话共用）。两个都没有就判不了
- 🎨 界面里的背景和头像是 AI 生成插画的裁切件，再分发请自行换图

## 🛠️ 开发

```sh
node plugin/test/guard.test.mjs
```

## 📄 许可证

MIT