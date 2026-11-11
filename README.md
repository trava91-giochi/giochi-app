# Giochi

PWA personale per giocare sul telefono a giochi Game Boy, Game Boy Color e Game Boy Advance, con [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS).

- **Nessun gioco e nessun salvataggio nel repo.** I giochi si importano dal telefono e restano nel suo IndexedDB; l'app non manda nulla in rete (CSP `connect-src 'self'`).
- **Salvataggi:** quello del gioco (`.srm`, più `.rtc` per l'orologio) viene copiato dall'app a ogni modifica. Quando l'app va in background si fa anche un'istantanea, per riprendere subito. "Backup" scarica i tre file nella cartella Download.
- **Offline:** il service worker mette in cache l'app ed EmulatorJS 4.2.3 con i core gambatte e mgba (`vendor/emulatorjs/`, GPL-3.0: vedi il suo `LEGGIMI.md`).
