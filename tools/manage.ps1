Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

# ---------- 状态文件 ----------
if ($env:DSH_HOME) { $stateDir = $env:DSH_HOME } else { $stateDir = Join-Path $env:USERPROFILE '.dsh' }
$statePath = Join-Path $stateDir 'prevent-peep.json'
$assetsDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets'
$bgPath = Join-Path $assetsDir 'background.jpg'
$avatarPath = Join-Path $assetsDir 'avatar.png'

function Get-Defaults {
    return [ordered]@{
        mode         = 'ask'
        enforceRoots = @('D:\')
        allowRoots   = @('D:\TE_Code', 'D:\DSH')
        denyRoots    = @()
        scanShell    = $true
        relativeBase = ''
    }
}

function Read-State {
    $state = Get-Defaults
    if (Test-Path -LiteralPath $statePath) {
        try {
            $raw = [System.IO.File]::ReadAllText($statePath, [System.Text.Encoding]::UTF8)
            $json = $raw | ConvertFrom-Json
            foreach ($key in @($state.Keys)) {
                if ($null -ne $json.PSObject.Properties[$key]) { $state[$key] = $json.$key }
            }
        } catch {
            [System.Windows.Forms.MessageBox]::Show("配置文件解析失败，将使用默认值。`n$statePath", 'Prevent-peep') | Out-Null
        }
    }
    return $state
}

function Write-State($state) {
    $out = [ordered]@{
        mode         = [string]$state.mode
        enforceRoots = @($state.enforceRoots | Where-Object { $_ })
        allowRoots   = @($state.allowRoots | Where-Object { $_ })
        denyRoots    = @($state.denyRoots | Where-Object { $_ })
        scanShell    = [bool]$state.scanShell
    }
    if ($state.relativeBase) { $out.relativeBase = [string]$state.relativeBase }
    if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    $text = ($out | ConvertTo-Json -Depth 5) + "`n"
    [System.IO.File]::WriteAllText($statePath, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------- 配色 ----------
$C_BG      = [System.Drawing.ColorTranslator]::FromHtml('#F5F7FF')
$C_BORDER  = [System.Drawing.ColorTranslator]::FromHtml('#DCE6F8')
$C_TEXT    = [System.Drawing.ColorTranslator]::FromHtml('#1B2A4A')
$C_MUTED   = [System.Drawing.ColorTranslator]::FromHtml('#5F7191')
$C_ACCENT  = [System.Drawing.ColorTranslator]::FromHtml('#5C8DF6')
$C_ACCENT2 = [System.Drawing.ColorTranslator]::FromHtml('#3F72E0')
$C_PINK    = [System.Drawing.ColorTranslator]::FromHtml('#F58BB0')
$C_LINE    = [System.Drawing.ColorTranslator]::FromHtml('#D6DEF0')
$C_HEADER  = [System.Drawing.ColorTranslator]::FromHtml('#DCE9FF')
$C_HEADER2 = [System.Drawing.ColorTranslator]::FromHtml('#2C4470')
$C_FIELD   = [System.Drawing.ColorTranslator]::FromHtml('#FBFCFE')

$fontName = 'Microsoft YaHei UI'
try { $null = New-Object System.Drawing.Font($fontName, 9) } catch { $fontName = 'Segoe UI' }

# 卡片矩形（同时用于烘焙进背景与摆放控件）
$cardA = New-Object System.Drawing.Rectangle(20, 164, 430, 300)
$cardB = New-Object System.Drawing.Rectangle(470, 164, 430, 300)
$cardC = New-Object System.Drawing.Rectangle(20, 480, 560, 250)
$cardD = New-Object System.Drawing.Rectangle(600, 480, 300, 250)
$cards = @($cardA, $cardB, $cardC, $cardD)

# ---------- 拖动窗口（无边框） ----------
$dragReady = $true
try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class PeepDrag {
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
"@ -ErrorAction Stop
} catch { $dragReady = $false }

# ---------- 图形工具 ----------
function New-RoundedPath([int]$w, [int]$h, [int]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [Math]::Max(1, $r * 2)
    if ($d -gt $w) { $d = $w }
    if ($d -gt $h) { $d = $h }
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($w - $d, 0, $d, $d, 270, 90)
    $path.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
    $path.AddArc(0, $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-TopRoundedPath([int]$w, [int]$h, [int]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [Math]::Max(1, $r * 2)
    if ($d -gt $w) { $d = $w }
    if ($d -gt $h) { $d = $h }
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($w - $d, 0, $d, $d, 270, 90)
    $path.AddLine($w, $r * 2, $w, $h)
    $path.AddLine($w, $h, 0, $h)
    $path.CloseFigure()
    return $path
}

function Add-Feather($g, [int]$x, [int]$y, [int]$w, [int]$h, [int]$f) {
    $c1 = [System.Drawing.Color]::FromArgb(110, 255, 255, 255)
    $c2 = [System.Drawing.Color]::FromArgb(0, 255, 255, 255)
    $specs = @(
        @{ R = (New-Object System.Drawing.Rectangle -ArgumentList $x, $y, $f, $h); A = 0 },
        @{ R = (New-Object System.Drawing.Rectangle -ArgumentList ($x + $w - $f), $y, $f, $h); A = 180 },
        @{ R = (New-Object System.Drawing.Rectangle -ArgumentList $x, $y, $w, $f); A = 90 },
        @{ R = (New-Object System.Drawing.Rectangle -ArgumentList $x, ($y + $h - $f), $w, $f); A = 270 }
    )
    foreach ($spec in $specs) {
        $r = $spec.R
        $b = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $r, $c1, $c2, ([single]$spec.A)
        $g.FillRectangle($b, $r)
        $b.Dispose()
    }
}

function Get-SoftBackdrop([string]$path, [int]$w, [int]$h) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $ms = New-Object System.IO.MemoryStream(,$bytes)
    $src = [System.Drawing.Image]::FromStream($ms)

    # 主体缩到 75% 居中；四周用「同一张图重度虚化铺满」代替扩图（避免镜像重复）
    $fit = [Math]::Min($w / $src.Width, $h / $src.Height) * 0.75
    $dw = [Math]::Max(1, [int]($src.Width * $fit))
    $dh = [Math]::Max(1, [int]($src.Height * $fit))
    $dx = [int](($w - $dw) / 2)
    $dy = [int](($h - $dh) / 2)

    $tiny = New-Object System.Drawing.Bitmap([Math]::Max(2, [int]($w / 22)), [Math]::Max(2, [int]($h / 22)))
    $gt = [System.Drawing.Graphics]::FromImage($tiny)
    $gt.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gt.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $tiny.Width, $tiny.Height)), (New-Object System.Drawing.Rectangle(0, 0, $src.Width, $src.Height)), [System.Drawing.GraphicsUnit]::Pixel)
    $gt.Dispose()

    $full = New-Object System.Drawing.Bitmap($w, $h)
    $g2 = [System.Drawing.Graphics]::FromImage($full)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($tiny, 0, 0, $w, $h)

    # 中心主体：轻微透明 + 宽羽化，避免出现生硬的矩形接缝
    $ia = New-Object System.Drawing.Imaging.ImageAttributes
    $cm = New-Object System.Drawing.Imaging.ColorMatrix
    $cm.Matrix33 = 0.9
    $ia.SetColorMatrix($cm)
    $g2.DrawImage($src, (New-Object System.Drawing.Rectangle($dx, $dy, $dw, $dh)), 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
    $ia.Dispose()
    Add-Feather $g2 $dx $dy $dw $dh 130

    # 薄纱
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $veil = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(132, 255, 255, 255),
        [System.Drawing.Color]::FromArgb(108, 255, 255, 255),
        90)
    $g2.FillRectangle($veil, $rect)
    $veil.Dispose()

    $topRect = New-Object System.Drawing.Rectangle(0, 0, $w, 150)
    $topVeil = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $topRect,
        [System.Drawing.Color]::FromArgb(228, 255, 255, 255),
        [System.Drawing.Color]::FromArgb(132, 255, 255, 255),
        90)
    $g2.FillRectangle($topVeil, $topRect)
    $topVeil.Dispose()

    # 半透明卡片烘焙进背景（控件以透明背景叠在上面）
    $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    foreach ($card in $cards) {
        $cp = New-RoundedPath ($card.Width - 1) ($card.Height - 1) 14
        $state = $g2.Save()
        $g2.TranslateTransform($card.X, $card.Y)
        $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(178, 255, 255, 255))
        $g2.FillPath($fill, $cp)
        $fill.Dispose()
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(235, 220, 230, 248), 1)
        $g2.DrawPath($pen, $cp)
        $pen.Dispose()
        $g2.Restore($state)
        $cp.Dispose()
    }

    $g2.Dispose()
    $tiny.Dispose()
    $src.Dispose()
    $ms.Dispose()
    return $full
}
function Get-Avatar([string]$path, [int]$size) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $ms = New-Object System.IO.MemoryStream(,$bytes)
    $src = [System.Drawing.Image]::FromStream($ms)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
    $clip.AddEllipse(0, 0, $size - 1, $size - 1)
    $g.SetClip($clip)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    $g.ResetClip()
    $ring = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 3)
    $g.DrawEllipse($ring, 2, 2, $size - 5, $size - 5)
    $ring.Dispose(); $g.Dispose(); $src.Dispose(); $ms.Dispose()
    return $bmp
}

function New-Label($parent, $text, $x, $y, $w, $h, $size, $color, $bold) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $text
    $label.Location = New-Object System.Drawing.Point($x, $y)
    $label.Size = New-Object System.Drawing.Size($w, $h)
    $label.ForeColor = $color
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $label.Font = New-Object System.Drawing.Font($fontName, $size, $style)
    $label.BackColor = [System.Drawing.Color]::Transparent
    $parent.Controls.Add($label)
    return $label
}

function New-Button($parent, $text, $x, $y, $w, $h, $primary) {
    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = $text
    $btn.Location = New-Object System.Drawing.Point($x, $y)
    $btn.Size = New-Object System.Drawing.Size($w, $h)
    $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $btn.FlatAppearance.BorderSize = 0
    $btn.Cursor = [System.Windows.Forms.Cursors]::Hand
    $btn.Font = New-Object System.Drawing.Font($fontName, 9)
    if ($primary) {
        $btn.BackColor = $C_ACCENT
        $btn.ForeColor = [System.Drawing.Color]::White
        $btn.FlatAppearance.MouseOverBackColor = $C_ACCENT2
        $btn.FlatAppearance.MouseDownBackColor = $C_ACCENT2
    } else {
        $btn.BackColor = [System.Drawing.Color]::White
        $btn.ForeColor = $C_TEXT
        $btn.FlatAppearance.BorderSize = 1
        $btn.FlatAppearance.BorderColor = $C_LINE
        $btn.FlatAppearance.MouseOverBackColor = [System.Drawing.ColorTranslator]::FromHtml('#EEF3FF')
        $btn.FlatAppearance.MouseDownBackColor = [System.Drawing.ColorTranslator]::FromHtml('#E3ECFF')
    }
    $btn.Region = New-Object System.Drawing.Region -ArgumentList (New-RoundedPath $w $h 9)
    $parent.Controls.Add($btn)
    return $btn
}

function New-ListBox($parent, $x, $y, $w, $h) {
    $list = New-Object System.Windows.Forms.ListBox
    $list.Location = New-Object System.Drawing.Point($x, $y)
    $list.Size = New-Object System.Drawing.Size($w, $h)
    $list.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $list.BackColor = $C_FIELD
    $list.ForeColor = $C_TEXT
    $list.Font = New-Object System.Drawing.Font($fontName, 9.5)
    $list.HorizontalScrollbar = $true
    $list.IntegralHeight = $false
    $parent.Controls.Add($list)
    return $list
}

function Add-Folder($listBox, $title) {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $title
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $path = $dialog.SelectedPath
        if (-not $path) { return }
        foreach ($item in $listBox.Items) {
            if ([string]::Equals([string]$item, $path, [System.StringComparison]::OrdinalIgnoreCase)) { return }
        }
        [void]$listBox.Items.Add($path)
    }
}

function Remove-Selected($listBox) {
    if ($listBox.SelectedIndex -ge 0) { $listBox.Items.RemoveAt($listBox.SelectedIndex) }
}

# ---------- 组装窗口 ----------
$state = Read-State

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Prevent-peep — 大肥鱼安全助手'
$form.ClientSize = New-Object System.Drawing.Size(920, 774)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_BG
$form.Font = New-Object System.Drawing.Font($fontName, 9)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.MaximizeBox = $false
$form.KeyPreview = $true
$form.Region = New-Object System.Drawing.Region -ArgumentList (New-RoundedPath 920 774 18)
$form.Add_Paint({
    param($sender, $e)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#C9D8F2')), 1
    $g = New-RoundedPath ($sender.Width - 1) ($sender.Height - 1) 18
    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $e.Graphics.DrawPath($pen, $g)
    $pen.Dispose(); $g.Dispose()
})

if (Test-Path -LiteralPath $bgPath) {
    try {
        $form.BackgroundImage = Get-SoftBackdrop $bgPath $form.ClientSize.Width $form.ClientSize.Height
        $form.BackgroundImageLayout = [System.Windows.Forms.ImageLayout]::None
    } catch {
        $form.BackgroundImage = $null
    }
}

# ---------- 自定义标题栏 ----------
$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(920, 44)
$header.BackColor = $C_HEADER
$header.Region = New-Object System.Drawing.Region -ArgumentList (New-TopRoundedPath 920 44 18)
$form.Controls.Add($header)

$null = New-Label $header 'Prevent-peep · 大肥鱼安全助手' 20 12 400 24 11 $C_HEADER2 $true

$closeBtn = New-Object System.Windows.Forms.Button
$closeBtn.Text = '✕'
$closeBtn.Location = New-Object System.Drawing.Point(872, 9)
$closeBtn.Size = New-Object System.Drawing.Size(34, 26)
$closeBtn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeBtn.FlatAppearance.BorderSize = 0
$closeBtn.FlatAppearance.MouseOverBackColor = $C_PINK
$closeBtn.FlatAppearance.MouseDownBackColor = [System.Drawing.ColorTranslator]::FromHtml('#E2648C')
$closeBtn.BackColor = $C_HEADER
$closeBtn.ForeColor = $C_HEADER2
$closeBtn.Font = New-Object System.Drawing.Font($fontName, 10)
$closeBtn.Cursor = [System.Windows.Forms.Cursors]::Hand
$header.Controls.Add($closeBtn)
$closeBtn.Add_Click({ $form.Close() })

if ($dragReady) {
    $dragHandler = {
        try {
            [PeepDrag]::ReleaseCapture() | Out-Null
            [PeepDrag]::SendMessage($form.Handle, 0xA1, [IntPtr]2, [IntPtr]::Zero) | Out-Null
        } catch { }
    }
    $header.Add_MouseDown($dragHandler)
    foreach ($child in $header.Controls) {
        if ($child -is [System.Windows.Forms.Label]) { $child.Add_MouseDown($dragHandler) }
    }
}

# ---------- 头部信息 ----------
$null = New-Label $form '文件访问守卫' 26 62 300 30 16 $C_TEXT $true
$accentBar = New-Object System.Windows.Forms.Panel
$accentBar.Location = New-Object System.Drawing.Point(28, 96)
$accentBar.Size = New-Object System.Drawing.Size(38, 4)
$accentBar.BackColor = $C_PINK
$form.Controls.Add($accentBar)
$null = New-Label $form '大肥鱼在盯着你的文件夹，别乱翻哦' 26 106 470 22 9.5 $C_MUTED $false
$null = New-Label $form ("保存后 1 秒内生效，无需重启　·　" + $statePath) 26 130 700 20 8.5 $C_MUTED $false

if (Test-Path -LiteralPath $avatarPath) {
    try {
        $avatar = New-Object System.Windows.Forms.PictureBox
        $avatar.Image = Get-Avatar $avatarPath 68
        $avatar.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::StretchImage
        $avatar.Size = New-Object System.Drawing.Size(68, 68)
        $avatar.Location = New-Object System.Drawing.Point(828, 56)
        $avatar.BackColor = [System.Drawing.Color]::Transparent
        $form.Controls.Add($avatar)
    } catch { }
}

# ---------- 卡片内容（卡片底已烘焙进背景） ----------
$null = New-Label $form '白名单 · 永远允许' 40 180 380 24 11 $C_TEXT $true
$null = New-Label $form '这些目录及其子目录不会被拦截' 40 206 380 20 8.5 $C_MUTED $false
$allowList = New-ListBox $form 40 232 390 172
$allowAdd = New-Button $form '＋ 添加文件夹' 40 414 150 34 $true
$allowRemove = New-Button $form '移除所选' 202 414 110 34 $false

$null = New-Label $form '黑名单 · 永远检查' 490 180 380 24 11 $C_TEXT $true
$null = New-Label $form '优先级最高，覆盖白名单与受管根' 490 206 380 20 8.5 $C_MUTED $false
$denyList = New-ListBox $form 490 232 390 172
$denyAdd = New-Button $form '＋ 添加文件夹' 490 414 150 34 $true
$denyRemove = New-Button $form '移除所选' 652 414 110 34 $false

$null = New-Label $form '受管根 · 检查范围' 40 496 480 24 11 $C_TEXT $true
$null = New-Label $form '只有落在这些目录下的路径才会被检查' 40 522 480 20 8.5 $C_MUTED $false
$enforceList = New-ListBox $form 40 548 520 120
$enforceAdd = New-Button $form '＋ 添加文件夹' 40 678 150 34 $false
$enforceRemove = New-Button $form '移除所选' 202 678 110 34 $false

$null = New-Label $form '行为' 620 496 260 24 11 $C_TEXT $true
$null = New-Label $form '命中时' 620 532 70 24 9 $C_MUTED $false

$modeBox = New-Object System.Windows.Forms.ComboBox
$modeBox.DropDownStyle = 'DropDownList'
$modeBox.Location = New-Object System.Drawing.Point(696, 529)
$modeBox.Size = New-Object System.Drawing.Size(184, 28)
$modeBox.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$modeBox.Font = New-Object System.Drawing.Font($fontName, 9)
[void]$modeBox.Items.Add('ask · 弹窗询问')
[void]$modeBox.Items.Add('deny · 直接拒绝')
$modeBox.SelectedIndex = if ($state.mode -eq 'deny') { 1 } else { 0 }
$form.Controls.Add($modeBox)

$scanBox = New-Object System.Windows.Forms.CheckBox
$scanBox.Text = '扫描 pwsh 命令串（启发式）'
$scanBox.Location = New-Object System.Drawing.Point(620, 570)
$scanBox.Size = New-Object System.Drawing.Size(260, 26)
$scanBox.ForeColor = $C_TEXT
$scanBox.Font = New-Object System.Drawing.Font($fontName, 9)
$scanBox.BackColor = [System.Drawing.Color]::Transparent
$scanBox.Checked = [bool]$state.scanShell
$form.Controls.Add($scanBox)

$null = New-Label $form '相对路径基准（可选）' 620 606 260 22 9 $C_MUTED $false
$baseBox = New-Object System.Windows.Forms.TextBox
$baseBox.Location = New-Object System.Drawing.Point(620, 630)
$baseBox.Size = New-Object System.Drawing.Size(256, 26)
$baseBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$baseBox.Font = New-Object System.Drawing.Font($fontName, 9)
$baseBox.Text = [string]$state.relativeBase
$form.Controls.Add($baseBox)

$openButton = New-Button $form '打开配置文件' 620 672 140 34 $false

# ---------- 底部 ----------
$hintLabel = New-Label $form '提示：黑名单优先于白名单；受管根之外的路径不受检查。' 26 748 470 20 8.5 $C_MUTED $false
$statusLabel = New-Label $form '' 500 748 190 20 8.5 $C_ACCENT $false
$saveButton = New-Button $form '保存' 700 738 90 34 $true
$closeButton = New-Button $form '关闭' 800 738 90 34 $false

# ---------- 事件 ----------
$allowAdd.Add_Click({ Add-Folder $allowList '选择要加入白名单的文件夹（永远允许）' })
$allowRemove.Add_Click({ Remove-Selected $allowList })
$denyAdd.Add_Click({ Add-Folder $denyList '选择要加入黑名单的文件夹（永远检查）' })
$denyRemove.Add_Click({ Remove-Selected $denyList })
$enforceAdd.Add_Click({ Add-Folder $enforceList '选择受管根目录' })
$enforceRemove.Add_Click({ Remove-Selected $enforceList })

$openButton.Add_Click({
    if (Test-Path -LiteralPath $statePath) {
        Start-Process notepad.exe -ArgumentList $statePath
    } else {
        [System.Windows.Forms.MessageBox]::Show('还没有配置文件，先点「保存」生成一个。', 'Prevent-peep') | Out-Null
    }
})

$saveButton.Add_Click({
    $newState = [ordered]@{
        mode         = if ($modeBox.SelectedIndex -eq 1) { 'deny' } else { 'ask' }
        enforceRoots = @($enforceList.Items | ForEach-Object { [string]$_ })
        allowRoots   = @($allowList.Items | ForEach-Object { [string]$_ })
        denyRoots    = @($denyList.Items | ForEach-Object { [string]$_ })
        scanShell    = [bool]$scanBox.Checked
        relativeBase = [string]$baseBox.Text
    }
    try {
        Write-State $newState
        $statusLabel.Text = '已保存 · ' + (Get-Date -Format 'HH:mm:ss') + ' · 立即生效'
    } catch {
        [System.Windows.Forms.MessageBox]::Show("保存失败：`n$($_.Exception.Message)", 'Prevent-peep') | Out-Null
    }
})

$closeButton.Add_Click({ $form.Close() })
$form.Add_KeyDown({ param($sender, $e) if ($e.KeyCode -eq 'Escape') { $form.Close() } })

foreach ($item in @($state.allowRoots)) { if ($item) { [void]$allowList.Items.Add([string]$item) } }
foreach ($item in @($state.denyRoots)) { if ($item) { [void]$denyList.Items.Add([string]$item) } }
foreach ($item in @($state.enforceRoots)) { if ($item) { [void]$enforceList.Items.Add([string]$item) } }

$form.AcceptButton = $saveButton
[void]$form.ShowDialog()
