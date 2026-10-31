' Avvia l'agente di controllo remoto in background, SENZA finestra visibile.
' Usato dall'avvio automatico a ogni login di Windows.
Dim fso, folder, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -STA -File """ & folder & "\controllo-remoto.ps1"" -Background"
' il terzo parametro 0 = finestra nascosta; False = non aspettare
CreateObject("WScript.Shell").Run cmd, 0, False
