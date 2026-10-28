Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

# ---------- 状态文件 ----------
if ($env:DSH_HOME) { $stateDir = $env:DSH_HOME } else { $stateDir = Join-Path $env:USERPROFILE '.dsh' }
$statePath = Join-Path $stateDir 'prevent-peep.json'

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

# ---------- 外观 ----------
$C_BG      = [System.Drawing.ColorTranslator]::FromHtml('#F4F6F9')
$C_CARD    = [System.Drawing.Color]::White
$C_BORDER  = [System.Drawing.ColorTranslator]::FromHtml('#E4E7EC')
$C_TEXT    = [System.Drawing.ColorTranslator]::FromHtml('#101828')
$C_MUTED   = [System.Drawing.ColorTranslator]::FromHtml('#667085')
$C_ACCENT  = [System.Drawing.ColorTranslator]::FromHtml('#2F6FED')
$C_ACCENT2 = [System.Drawing.ColorTranslator]::FromHtml('#1E5BD6')
$C_GHOST   = [System.Drawing.Color]::White
$C_LINE    = [System.Drawing.ColorTranslator]::FromHtml('#D0D5DD')
$C_FIELD   = [System.Drawing.ColorTranslator]::FromHtml('#FCFCFD')

$fontName = 'Microsoft YaHei UI'
try { $null = New-Object System.Drawing.Font($fontName, 9) } catch { $fontName = 'Segoe UI' }

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

function Add-RoundedCard($parent, $x, $y, $w, $h) {
    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point($x, $y)
    $panel.Size = New-Object System.Drawing.Size($w, $h)
    $panel.BackColor = $C_CARD
    $panel.Region = New-Object System.Drawing.Region -ArgumentList (New-RoundedPath ($w - 1) ($h - 1) 12)
    $panel.Add_Paint({
        param($sender, $e)
        $pen = New-Object System.Drawing.Pen $C_BORDER, 1
        $g = New-RoundedPath ($sender.Width - 1) ($sender.Height - 1) 12
        $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $e.Graphics.DrawPath($pen, $g)
        $pen.Dispose(); $g.Dispose()
    })
    $parent.Controls.Add($panel)
    return $panel
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
        $btn.BackColor = $C_GHOST
        $btn.ForeColor = $C_TEXT
        $btn.FlatAppearance.BorderSize = 1
        $btn.FlatAppearance.BorderColor = $C_LINE
        $btn.FlatAppearance.MouseOverBackColor = [System.Drawing.ColorTranslator]::FromHtml('#F2F4F7')
        $btn.FlatAppearance.MouseDownBackColor = [System.Drawing.ColorTranslator]::FromHtml('#EAECF0')
    }
    $btn.Region = New-Object System.Drawing.Region -ArgumentList (New-RoundedPath $w $h 8)
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
$form.ClientSize = New-Object System.Drawing.Size(920, 710)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_BG
$form.Font = New-Object System.Drawing.Font($fontName, 9)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false

$null = New-Label $form 'Prevent-peep' 24 18 300 30 15 $C_TEXT $true
$null = New-Label $form '大肥鱼安全助手 · 文件访问守卫（保存后 1 秒内生效，无需重启）' 24 50 720 22 9 $C_MUTED $false
$null = New-Label $form ("配置：" + $statePath) 24 72 860 20 8.5 $C_MUTED $false

# 白名单
$allowCard = Add-RoundedCard $form 20 106 430 300
$null = New-Label $allowCard '白名单 · 永远允许' 20 16 380 24 11 $C_TEXT $true
$null = New-Label $allowCard '这些目录及其子目录不会被拦截' 20 42 380 20 8.5 $C_MUTED $false
$allowList = New-ListBox $allowCard 20 68 390 174
$allowAdd = New-Button $allowCard '＋ 添加文件夹' 20 252 150 34 $true
$allowRemove = New-Button $allowCard '移除所选' 182 252 110 34 $false

# 黑名单
$denyCard = Add-RoundedCard $form 470 106 430 300
$null = New-Label $denyCard '黑名单 · 永远检查' 20 16 380 24 11 $C_TEXT $true
$null = New-Label $denyCard '优先级最高，覆盖白名单与受管根' 20 42 380 20 8.5 $C_MUTED $false
$denyList = New-ListBox $denyCard 20 68 390 174
$denyAdd = New-Button $denyCard '＋ 添加文件夹' 20 252 150 34 $true
$denyRemove = New-Button $denyCard '移除所选' 182 252 110 34 $false

# 受管根
$enforceCard = Add-RoundedCard $form 20 422 560 250
$null = New-Label $enforceCard '受管根 · 检查范围' 20 16 480 24 11 $C_TEXT $true
$null = New-Label $enforceCard '只有落在这些目录下的路径才会被检查' 20 42 480 20 8.5 $C_MUTED $false
$enforceList = New-ListBox $enforceCard 20 68 520 122
$enforceAdd = New-Button $enforceCard '＋ 添加文件夹' 20 200 150 34 $false
$enforceRemove = New-Button $enforceCard '移除所选' 182 200 110 34 $false

# 行为
$optionCard = Add-RoundedCard $form 600 422 300 250
$null = New-Label $optionCard '行为' 20 16 260 24 11 $C_TEXT $true
$null = New-Label $optionCard '命中时' 20 52 70 24 9 $C_MUTED $false

$modeBox = New-Object System.Windows.Forms.ComboBox
$modeBox.DropDownStyle = 'DropDownList'
$modeBox.Location = New-Object System.Drawing.Point(96, 49)
$modeBox.Size = New-Object System.Drawing.Size(184, 28)
$modeBox.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$modeBox.Font = New-Object System.Drawing.Font($fontName, 9)
[void]$modeBox.Items.Add('ask · 弹窗询问')
[void]$modeBox.Items.Add('deny · 直接拒绝')
$modeBox.SelectedIndex = if ($state.mode -eq 'deny') { 1 } else { 0 }
$optionCard.Controls.Add($modeBox)

$scanBox = New-Object System.Windows.Forms.CheckBox
$scanBox.Text = '扫描 pwsh 命令串（启发式）'
$scanBox.Location = New-Object System.Drawing.Point(20, 90)
$scanBox.Size = New-Object System.Drawing.Size(260, 26)
$scanBox.ForeColor = $C_TEXT
$scanBox.Font = New-Object System.Drawing.Font($fontName, 9)
$scanBox.Checked = [bool]$state.scanShell
$optionCard.Controls.Add($scanBox)

$null = New-Label $optionCard '相对路径基准（可选）' 20 126 260 22 9 $C_MUTED $false
$baseBox = New-Object System.Windows.Forms.TextBox
$baseBox.Location = New-Object System.Drawing.Point(20, 150)
$baseBox.Size = New-Object System.Drawing.Size(256, 26)
$baseBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$baseBox.Font = New-Object System.Drawing.Font($fontName, 9)
$baseBox.Text = [string]$state.relativeBase
$optionCard.Controls.Add($baseBox)

$openButton = New-Button $optionCard '打开配置文件' 20 192 140 34 $false

# 底部
$null = New-Label $form '提示：黑名单优先于白名单；受管根之外的路径不受检查。' 24 690 470 20 8.5 $C_MUTED $false
$statusLabel = New-Label $form '' 500 690 190 20 8.5 $C_ACCENT $false
$saveButton = New-Button $form '保存' 700 680 90 36 $true
$closeButton = New-Button $form '关闭' 800 680 90 36 $false

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

foreach ($item in @($state.allowRoots)) { if ($item) { [void]$allowList.Items.Add([string]$item) } }
foreach ($item in @($state.denyRoots)) { if ($item) { [void]$denyList.Items.Add([string]$item) } }
foreach ($item in @($state.enforceRoots)) { if ($item) { [void]$enforceList.Items.Add([string]$item) } }

$form.AcceptButton = $saveButton
[void]$form.ShowDialog()
