# Istruzioni Codex — GitHub Remote Ops

Per le richieste pertinenti usa la skill `runcommand` del plugin personale **GitHub Remote Ops**. Le istruzioni complete della versione **0.1.12** e le preferenze operative sono conservate nel plugin privato dell'account.

Riconosci i richiami `gitcommand`, `Ran command`, `RunCommand`, `runcommand` ed `esegui runcommand` senza distinzione tra maiuscole e minuscole. Sono alias conversazionali della skill, non eseguibili di sistema.

Leggi e applica la skill disponibile nell'ambiente prima dell'operazione. Verifica che il plugin e i connettori necessari siano effettivamente disponibili; questa istruzione non li installa né li attiva. Per le risorse di supporto usa i percorsi della skill installata, non percorsi presunti nel repository.

Per commit e push richiesti verifica repository, branch e remoto effettivi. Includi soltanto i file pertinenti, conserva le modifiche dell'utente e verifica il risultato. Non ripiegare automaticamente da `main` a `master`.
