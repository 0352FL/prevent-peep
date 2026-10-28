# 🐟 Prevent-peep · 大肥鱼文件夹防窥眼罩

[English](README.md) | [简体中文](README.zh.md)

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

双击 `plugin/大肥鱼我真该控制你了！.cmd`，剩下的看界面就行。

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
  "alertPopup": true
}
```

| 字段 | 含义 |
| --- | --- |
| `mode` | `ask` 弹审批卡片，`deny` 直接拒绝 |
| `allowRoots` | 永远放行 |
| `denyRoots` | 永远盘问（最高优先级） |
| `enforceRoots` | 只管这些目录下的路径 |
| `scanShell` | 连 `pwsh` 命令里的路径字样一起扫 |
| `alertSound` | 🔔 叮一声 |
| `alertCustom` | 🪟 自制无声通知窗 |
| `alertToast` | 💬 Windows 原生气泡（自带系统音） |
| `alertPopup` | ⚠️ 必须点确认的弹窗 |

判定顺序：**黑名单 → 白名单 → 受管根**。

## 👀 它能看见哪些操作

`read`、`write`、`edit`、`glob`、`grep`、`read_image`、`present`、`working_directory`，以及 `pwsh` 的 `workdir` 参数。

## 🧠 一点良心话

- 🪄 `pwsh` 的检查是**启发式**：只按字面匹配受管根，拼字符串能绕
- 📐 相对路径只有带 `..` 时才解析判定
- 🎨 界面里的背景和头像是 AI 生成插画的裁切件，再分发请自行换图

## 🛠️ 开发

```sh
node plugin/test/guard.test.mjs
```

## 📄 许可证

MIT