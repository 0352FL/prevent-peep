# Prevent-peep · 大肥鱼文件夹防窥眼罩

[English](README.md) | [简体中文](README.zh.md)

给 **DeepSeek Harness** 用的路径守卫。任何文件类工具执行前，都会先拿目标路径
去比对白名单——越界就弹警报，而不是悄悄翻你的私人文件夹。

![界面](docs/ui.png)

## 为什么需要它

DSH 的智能体能读到你 Windows 账户能读的一切。这个插件在这前面加了一道闸门：
在**工具派发之前**拦截，被拒绝的调用根本不会碰磁盘。

## 功能

- **派发前拦截**：挂在 `tools/pre-execute` 瀑布事件上，不是提示词约束，模型说破
  嘴也绕不过去。
- **三个名单**
  - *白名单*：永远放行
  - *黑名单*：永远检查（优先级最高）
  - *受管根*：只有落在这里面的路径才管
- **四种独立提醒**，各有开关：系统提示音、自绘无声通知窗、Windows 托盘气泡
  （自带系统音）、模态确认框。
- **文件夹选择器**：原生“选择文件夹”对话框，改完自动保存，1 秒内生效，无需重启。
- **全局生效**：一份配置，所有工作区、会话、子代理共用。
- 覆盖 `read`、`write`、`edit`、`glob`、`grep`、`read_image`、`present`、
  `working_directory`，以及 `pwsh` 的 `workdir` 参数。

## 安装

需要带 `desktop`（或 `web`）profile 的 DSH。

```sh
git clone <本仓库> prevent-peep
dsh plugin --profile desktop add "<路径>/prevent-peep"
dsh plugin --profile desktop add "<路径>/prevent-peep-plugin"
```

两个包都要装：`prevent-peep` 是组合包（插件管理页显示的就是它），
`prevent-peep-plugin` 是它挂载的插件本体。装完重启一次 DSH。

## 使用

双击 `prevent-peep-plugin/` 里的启动器：

```
大肥鱼我真该控制你了！.cmd
```

窗口里可以增删文件夹、开关四种提醒、在 `ask`（弹窗询问）和 `deny`（直接拒绝）
之间切换。

配置保存在 `%USERPROFILE%\.dsh\prevent-peep.json`：

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
| `mode` | `ask` 弹审批卡片，`deny` 直接让调用失败 |
| `allowRoots` | 永远放行 |
| `denyRoots` | 永远检查（最高优先级） |
| `enforceRoots` | 只有这些目录下的路径才受管 |
| `scanShell` | 额外扫描 `pwsh` 命令串里的受管根字样 |
| `alertSound` | 播一声提示音 |
| `alertCustom` | 无声的自绘通知窗 |
| `alertToast` | Windows 原生托盘气泡（自带声音） |
| `alertPopup` | 模态确认框（无声） |

判定顺序：**黑名单 → 白名单 → 受管根**。

## 限制

- `pwsh` 检查是**启发式**：只在命令串里按字面匹配受管根。运行时拼接的路径
  （`"D:" + "\foo"`）能绕过。
- 相对路径只有在包含 `..` 时才会解析判定；普通相对路径视为在工作区内。
- 这是护栏，不是沙箱。真要保密请用 ACL、加密容器或独立 Windows 账户。

## 素材说明

`prevent-peep-plugin/assets/` 里是运行时美术资源：窗口背景、头像、桌面快捷方式用的
`.ico`。它们是 AI 生成插画的裁切衍生品——如果要再分发插件，建议替换成你自己的图。

## 开发

```sh
node prevent-peep-plugin/test/guard.test.mjs
```

## 许可证

MIT