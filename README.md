# 🐟 Prevent-peep

[English](README.md) | [简体中文](README.zh.md) | [Changelog](CHANGELOG.md)

[![DeepSeek Harness Plugin](https://deepseekharnessplugins.com/api/badge/0352FL/prevent-peep)](https://deepseekharnessplugins.com/plugins/0352FL/prevent-peep)

> 🐟 When the big fat fish goes wandering, don't let it see what it shouldn't —
> and please don't let it upload any of it.
> 😏 Bonus: stops Holy Liang from roasting your XP choices.

A pair of blinkers for **DeepSeek Harness**. Every time the agent wants to touch a
file, it hits a gate first — and you decide whether it gets through.

## 🛡️ What it actually does

One window, three lists, four kinds of alert:

| List | Rule |
| --- | --- |
| ✅ Allow | always let through |
| 🚫 Deny | always questioned (highest priority) |
| 📁 Enforced roots | only paths under these are policed |

When something trips the gate, mix and match: **🔔 a ding**, **🪟 a silent
corner notification we draw ourselves**, **💬 the native Windows balloon**, or
**⚠️ a modal you have to click**.

Plus a native folder picker — no typing paths by hand. Changes save themselves and
land within a second, no restart.

## ⚠️ Read this: it's a soft lock, not a vault

It stops fat fingers and idle curiosity — not someone who really wants in:

- 🧱 It intercepts **DSH tool calls**, not the operating system
- 🪄 A path assembled inside `pwsh` (`"D:" + "\secret"`) is invisible to it
- 🚪 Reading the disk outside DSH, using another tool, or just clicking "allow"
  will sail right past it

If you need *nobody* to see it, use **ACLs / an encrypted container / a separate
Windows account** — that's a real lock. This plugin just makes snooping slightly
more expensive.

## 📦 Install

Requires DSH with a `desktop` or `web` profile. Both packages are needed: `bundle`
is what the plugin manager shows, `plugin` is the implementation.

```sh
git clone https://github.com/0352FL/prevent-peep
dsh plugin --profile desktop add "<path>/prevent-peep/bundle"
dsh plugin --profile desktop add "<path>/prevent-peep/plugin"
```

Restart DSH once afterwards 🔄

## 🎛️ Using it

Double-click `plugin/大肥鱼我真该控制你了！.cmd` and poke around. The lists start
empty, so the guard does nothing until you pick at least one enforced root.

Settings live in `%USERPROFILE%\.dsh\prevent-peep.json`:

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

| Key | Meaning |
| --- | --- |
| `mode` | `ask` pops the approval card, `deny` fails the call |
| `allowRoots` | always allowed |
| `denyRoots` | always questioned (highest priority) |
| `enforceRoots` | only paths here are policed |
| `scanShell` | also scan shell command strings for path-like fragments |
| `relativeBase` | base for relative paths (falls back to the last `working_directory`) |
| `alertSound` | 🔔 one short ding |
| `alertCustom` | 🪟 silent self-drawn notification |
| `alertToast` | 💬 native Windows balloon (brings its own sound) |
| `alertPopup` | ⚠️ modal confirmation |

Resolution order: **deny → allow → enforced root**. Paths are fully resolved
first (`..`, `\\?\`, `\\localhost\D$`, `D:foo`, `/` vs `\`, letter case), and on
Windows symlinks / junctions / 8.3 short names are followed too — if either the
literal or the real path is out of bounds, it's out of bounds.

Advanced keys (not in the window, but the window keeps them when you save):

| Key | Default | Meaning |
| --- | --- | --- |
| `failClosed` | `false` | if the guard itself crashes: `false` lets the call through, `true` blocks it |
| `alertCooldownMs` | `5000` | minimum gap between alerts, so a looping agent can't flood your screen |
| `pathKeys` | `file_path`, `path`, `paths`, `workdir`, `cd`, … | arguments treated as a whole path |
| `scanKeys` | `pattern`, `glob`, `include`, `exclude`, `command` | arguments searched for absolute-path fragments |
| `shellTools` | `pwsh`, `powershell`, `bash`, `sh`, `shell`, `cmd` | tools whose `command` is governed by `scanShell` |
| `cwdTools` | `working_directory` | tools whose target becomes the relative-path base |

## 👀 What it watches

Any tool call whose arguments carry a path in `pathKeys`, or an absolute path
inside `scanKeys` — in practice `read`, `write`, `edit`, `glob` (including the
`pattern`), `grep`, `read_image`, `present`, `working_directory`, and `pwsh`
(both `workdir` and the command itself). File *contents* you ask it to write are
never scanned.

## 🧠 Honest limits

- 🪄 The shell scan is a **heuristic**: it pulls path-looking fragments out of the
  command. String concatenation, environment variables, or `cd D:` followed by a
  relative path in a later command still get past it
- 📐 Relative paths need a base: `relativeBase`, or the last `working_directory`
  the guard saw (shared across sessions). With neither, they can't be judged
- 🎨 The window background and avatar are crops of an AI-generated illustration —
  swap them out if you redistribute this

## 🛠️ Development

```sh
node plugin/test/guard.test.mjs
```

## 📄 License

MIT