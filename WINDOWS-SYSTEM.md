# Sessione Windows SYSTEM

`avvia-system.cmd` avvia una CLI nella radice di questa repository dopo aver
verificato il SID `S-1-5-18` (`NT AUTHORITY\SYSTEM`). Un account amministratore
normale non supera questo controllo. Il launcher usa queste opzioni:

| Client | Opzioni di avvio |
| --- | --- |
| Copilot (predefinito) | `--allow-all` |
| Claude Code | `--permission-mode bypassPermissions --settings .claude/system-session.json` |
| PowerShell | `-NoProfile -ExecutionPolicy Bypass` |

Il profilo Claude passato esplicitamente con `--settings` sopprime il dialogo
iniziale della modalità bypass. La modalità viene scelta tramite la CLI:
nelle versioni attuali `permissions.defaultMode: bypassPermissions` nei soli
file di progetto non la abilita. Le policy gestite e i controlli obbligatori
del client continuano ad applicarsi.

## Da una shell già SYSTEM

```powershell
.\avvia-system.cmd -CheckOnly
.\avvia-system.cmd
.\avvia-system.cmd -Client Claude
.\avvia-system.cmd -Client PowerShell
```

`-CheckOnly` restituisce identità, SID, host, repository e policy effettiva;
non avvia la CLI e non afferma che una CLI non avviata abbia attivato il bypass.
Per un eseguibile fuori dal PATH di SYSTEM:

```powershell
.\avvia-system.cmd -Client Claude -Executable 'C:\Tools\claude.exe'
```

Le CLI devono essere installate e autenticate nel contesto SYSTEM: il login
del normale utente Windows non viene copiato automaticamente. Per inoltrare
argomenti aggiuntivi, usa lo script da PowerShell:

```powershell
& .\scripts\start-system-session.ps1 -Client Copilot -ClientArguments @('--version')
```

## Da un terminale amministratore

Installa [PsExec di Microsoft Sysinternals](https://learn.microsoft.com/en-us/sysinternals/downloads/psexec)
e apri PowerShell come amministratore sul PC Windows autorizzato. Sostituisci
i percorsi con quelli della tua installazione:

```powershell
& 'C:\Tools\PsExec64.exe' -s -i powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\repos\REPOSITORY\scripts\start-system-session.ps1' -Client Copilot
```

PsExec richiede i diritti amministrativi ed esegue il processo come SYSTEM;
`-i` lo rende interattivo. Il primo utilizzo può richiedere l'accettazione
della licenza Sysinternals. Il launcher non installa PsExec né riconfigura
servizi. Per i runner GitHub Actions, l'account del servizio deve essere
già LocalSystem; un'etichetta contenente `system` da sola non assegna privilegi.

La policy PowerShell Bypass vale soltanto per il processo avviato. Non cambia
la policy macchina e non prevale sulle Group Policy. Codespaces e i
devcontainer Linux rimangono ambienti Linux: UID 0 non è un'identità Windows.
Una chat già aperta non cambia identità o ambiente grazie a un commit.

## Verifica

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-system-session.ps1
```

Il test verifica il rifiuto di identità diverse da SYSTEM, i flag inoltrati,
la directory di lavoro, i percorsi con spazi e il codice d'uscita usando una
CLI fittizia locale. Non avvia agenti AI né modifica servizi.

Riferimenti: [permessi Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools),
[modalità Claude Code](https://code.claude.com/docs/en/permission-modes),
[impostazioni Claude Code](https://code.claude.com/docs/en/settings-reference#skipdangerousmodepermissionprompt).
