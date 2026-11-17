# Sessioni Windows per d-4-38

Per una sessione locale SYSTEM con i permessi CLI richiesti dal proprietario,
usa `avvia-system.cmd` e la guida `WINDOWS-SYSTEM.md`. Il launcher verifica
il SID `S-1-5-18` e avvia Copilot con `--allow-all` dalla radice del progetto.

Riporta sempre l'identità osservata. Codespaces e i workflow Ubuntu restano
Linux; i file di istruzioni non conferiscono privilegi Windows né cambiano
una chat esistente. Le policy gestite e i permessi GitHub restano applicabili.
