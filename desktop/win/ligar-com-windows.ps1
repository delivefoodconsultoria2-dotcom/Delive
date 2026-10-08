# Cria o atalho de inicialização (liga escondido com o Windows) e o atalho na área de trabalho.
$d = Split-Path -Parent $MyInvocation.MyCommand.Path
$s = New-Object -ComObject WScript.Shell
$vbs = Join-Path $d 'Abrir TrafgFood.vbs'
$ico = Join-Path $d 'trafgfood.ico'

$a = $s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'TrafgFood.lnk'))
$a.TargetPath = 'wscript.exe'
$a.Arguments = '"' + $vbs + '" --segundo-plano'
$a.WorkingDirectory = $d
$a.IconLocation = $ico
$a.Save()

$b = $s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'TrafgFood.lnk'))
$b.TargetPath = 'wscript.exe'
$b.Arguments = '"' + $vbs + '"'
$b.WorkingDirectory = $d
$b.IconLocation = $ico
$b.Save()
