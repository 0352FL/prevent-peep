# 🐟 Prevent-peep

[English](README.md) | [简体中文](README.zh.md)

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

Double-click `plugin/大肥鱼我真该控制你了！.cmd` and poke around.

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
  "alertPopup": true
}
```

| Key | Meaning |
| --- | --- |
| `mode` | `ask` pops the approval card, `deny` fails the call |
| `allowRoots` | always allowed |
| `denyRoots` | always questioned (highest priority) |
| `enforceRoots` | only paths here are policed |
| `scanShell` | also scan `pwsh` command strings for enforced roots |
| `alertSound` | 🔔 one short ding |
| `alertCustom` | 🪟 silent self-drawn notification |
| `alertToast` | 💬 native Windows balloon (brings its own sound) |
| `alertPopup` | ⚠️ modal confirmation |

Resolution order: **deny → allow → enforced root**.

## 👀 What it watches

`read`, `write`, `edit`, `glob`, `grep`, `read_image`, `present`,
`working_directory`, plus the `workdir` argument of `pwsh`.

## 🧠 Honest limits

- 🪄 The `pwsh` scan is a **heuristic**: literal match on enforced roots, easy to
  dodge with string concatenation
- 📐 Relative paths are only evaluated when they contain `..`
- 🎨 The window background and avatar are crops of an AI-generated illustration —
  swap them out if you redistribute this

## 🛠️ Development

```sh
node plugin/test/guard.test.mjs
```

## 📄 License

MIT