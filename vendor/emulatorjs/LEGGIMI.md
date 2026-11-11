# EmulatorJS 4.2.3 (versione fissa)

File presi dai pacchetti npm ufficiali, senza modifiche. Integrità sha512 verificata l'11/11/2026.

| Pacchetto | Integrità | File presi |
|---|---|---|
| `@emulatorjs/emulatorjs@4.2.3` | `sha512-7z3qaA4LwyurhuGvdMUDF9xJpEbxC3SNy9+E9tSaOsRo8FCS2QXam/0k/lc9kqHWRFIlLKWahNjPAStyL0rFnw==` | `src/` (tutti tranne `socket.io.min.js`), `emulator.css`, `compression/extract7z.js`, `compression/extractzip.js`, `localization/it-IT.json`, `LICENSE` |
| `@emulatorjs/core-gambatte@4.2.3` | `sha512-Oq3AJL9SKnMsNAmtAP2eN934TQts3NHeaAe0z1BO9Lx/L3xDZKLpxL+XwgcSXIrl4Sx1oXxYEUwD7JjPEQ0DGg==` | `cores/gambatte-legacy-wasm.data`, `cores/reports/gambatte.json` |
| `@emulatorjs/core-mgba@4.2.3` | `sha512-daiHzZQKEr+P9fra7j5YoEAXiyYUEtBhFQ8EAV/SeCtrkvqtayU7GQ9LYgoSgzkKSwsbNSskApqGuA9EGARYPA==` | `cores/mgba-legacy-wasm.data`, `cores/reports/mgba.json` |

Si usano solo i core "legacy" (WebGL 1), perché l'app li forza con `forceLegacyCores`. Non servono i core a thread: GitHub Pages non manda gli header per `SharedArrayBuffer`.

**Licenza:** GPL-3.0 (`LICENSE`). Le licenze dei core sono dentro i file `.data`, che sono archivi 7z con `license.txt`.

**Sorgenti:**
- https://github.com/EmulatorJS/EmulatorJS (tag `v4.2.3`)
- https://github.com/EmulatorJS/gambatte-libretro
- https://github.com/EmulatorJS/mgba

**Per aggiornare:**
1. Scaricare i tre pacchetti npm della nuova versione e verificarne l'integrità.
2. Sostituire gli stessi file.
3. Cambiare `CACHE` in `sw.js`.
4. Riprovare con `dev/prova.html` che le istantanee si carichino ancora.
