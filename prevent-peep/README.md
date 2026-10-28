# Prevent-peep

Ask or deny **before** a DSH file tool touches a path outside your allowlist.
Ships a folder picker (`大肥鱼我真该控制你了！.cmd`) to manage the global allow/deny lists.

> 大肥鱼安全助手提醒您：这不是沙箱，而是**工具派发前的审批闸门**。

## What it does

- Listens to the `tools/pre-execute` waterfall and inspects path arguments.
- Resolution order: **deny list → allow list → enforced roots**.
- On a violation it returns `ask` (the host pops an approval prompt) or `deny`
  (hard failure), depending on `mode`.
- Covers `read`, `write`, `edit`, `glob`, `grep`, `read_image`, `present`,
  `working_directory`, and the `workdir` argument of `pwsh`.
- `pwsh` command strings get a **heuristic** scan for enforced roots: good
  against typos and casual snooping, useless against runtime string
  concatenation. Do not treat this as a security boundary.

## Install

```sh
npx @deepseek-ai/dsh plugin --profile desktop add prevent-peep
```

Or from a local checkout:

```sh
npx @deepseek-ai/dsh plugin --profile desktop add /path/to/prevent-peep
```

Restart DSH once after installing. List changes made in the folder picker take
effect immediately — no restart needed.

## Manage the lists

Double-click **`大肥鱼我真该控制你了！.cmd`** next to this README. It opens a small
window where you can:

- pick folders with the native **选择文件夹** dialog and add them to the
  allow list or the denylist;
- remove the selected entry;
- switch `mode` between `ask` (prompt) and `deny` (block silently);
- toggle the `pwsh` command-string heuristic.

Selections are written to `$DSH_HOME/prevent-peep.json` (default
`~/.dsh/prevent-peep.json`), so they are **global** — all workspaces, all
sessions, all subagents.

You can also edit that JSON by hand:

```json
{
  "mode": "ask",
  "enforceRoots": ["D:\\"],
  "allowRoots": ["D:\\TE_Code", "D:\\DSH"],
  "denyRoots": ["C:\\Users\\me\\private"],
  "scanShell": true,
  "relativeBase": "C:\\Users\\me\\work"
}
```

| Field | Meaning |
|---|---|
| `mode` | `ask` pops an approval prompt; `deny` fails the call |
| `enforceRoots` | only paths under these roots are policed |
| `allowRoots` | always allowed (wins over `enforceRoots`) |
| `denyRoots` | always policed (wins over `allowRoots`) |
| `scanShell` | scan `pwsh` command strings heuristically |
| `relativeBase` | base for resolving `..`-containing relative paths |

## Coverage limits

| Path form | Policed |
|---|---|
| Absolute path in a path argument | ✅ exact |
| `..`-relative path (resolved against `relativeBase`) | ✅ exact |
| Plain relative path (stays inside the workspace) | allowed by design |
| `pwsh workdir` | ✅ exact |
| `pwsh` command string containing an enforced root | ⚠️ heuristic |
| Path built at runtime inside a shell command | ❌ not detectable |

For real confidentiality, combine this with OS-level ACLs, an encrypted
container, or a separate Windows account.

## Development

```sh
node test/guard.test.mjs
```

## License

MIT
