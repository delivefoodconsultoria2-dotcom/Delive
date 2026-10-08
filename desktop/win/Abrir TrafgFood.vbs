' Abre o TrafgFood sem a janela preta. Se ele já estiver ligado, só abre o navegador.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
args = ""
If WScript.Arguments.Count > 0 Then args = " " & WScript.Arguments(0)
sh.Run """" & dir & "\TrafgFood.exe""" & args, 0, False
