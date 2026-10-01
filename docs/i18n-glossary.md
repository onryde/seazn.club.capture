# Translation glossary

The terms `src/i18n/{es,fr,nl}.json` use, so a new string matches the ones
already there. `en.json` is the source; this file is the target side. It was
built by the AI translation review of 2026-10-01 (see _Translation review_
below).

Who reads the copy: a volunteer at a ground, phone on a tripod, in sun or
rain. State is read at two metres, detail at arm's length (AGENTS §5–6). Copy
is plain and terse, and never alarming. A term a broadcast engineer would use
but a volunteer would not (slate, uplink, carton, placa) is replaced with the
plain word.

## Register and variant

| Language | Register                      | Variant                                | Why                                      |
| -------- | ----------------------------- | -------------------------------------- | ---------------------------------------- |
| es       | **tú** (toca, escanea, pide)  | Spain (móvil, Ajustes, mantén pulsado) | As the web product's es dictionaries.    |
| fr       | **vous** (touchez, scannez)   | France                                 | As the web product, and French app norm. |
| nl       | **je** (tik, scan; never _u_) | Netherlands                            | As the web product's nl dictionaries.    |

French stays on vous. The 2026-10-01 review brief suggested tu, but the file
already used vous throughout, as do all the web's French dictionaries (no
tu anywhere), and French operator apps address the user as vous. Moving to tu
is an owner decision, not a translation fix.

## Typography

- **French no-break space.** A no-break space (U+00A0) goes before `:` `;`
  `?` `!` and inside `« »`, so the mark never starts a line. Write it as
  ` ` in the JSON so it can be seen. A test that reads the screen can
  match it with a plain space, because Testing Library collapses whitespace.
  A test that compares `t()` output directly must write ` `.
- **Spanish** opens questions and exclamations with `¿` and `¡`. No string
  needs them today.
- **Status lines split on a colon.** English writes "Uplink lost — holding";
  es, fr and nl write a colon there (in fr, with the no-break space). That
  dash is English punctuation.
- **Button names in a sentence** are written as on the button, capitalised,
  without quotes: "mantén pulsado Emitir", "maintenez Arrêter", "houd
  Stoppen ingedrukt".
- **Case.** Write sentence case. Plates, buttons and titles are uppercased by
  the type scale (`src/ui/theme/type.ts`).
- **Apostrophe.** Straight (`'`), as in en.
- **Numbers and times** are not written into the copy. `formatNumber` gives
  the decimal comma (9,2), `formatTime` gives 24-hour `14:32`, and the elapsed
  clock is `H:MM:SS` in every language. A unit takes a plain space, as in en.
  Dutch writes `74%` with no space; es and fr write `74 %`.
- **Budgets** count characters with the widest values filled in
  (`src/i18n/budgets.test.ts`). When a correct translation does not fit,
  shorten it idiomatically; never cut the meaning.

## Terms

| en                                         | es                              | fr                                | nl                                     | Note                                                                                                                                  |
| ------------------------------------------ | ------------------------------- | --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Live Stream (mode)                         | Emisión en directo              | Diffusion en direct               | Livestream                             |                                                                                                                                       |
| Remote Scoring (mode)                      | Anotación remota                | Score à distance                  | Scoren op afstand                      | es: keeping score is _anotación_, as the web's _anotador_. _Puntuar un partido_ means to rate it.                                     |
| Dashboard (mode)                           | Panel                           | Tableau de bord                   | Dashboard                              | As the web.                                                                                                                           |
| broadcast, stream (the thing on air)       | la emisión                      | le direct                         | de stream                              | One noun each. fr keeps _diffusion_ only in the mode's name and its _code de diffusion_.                                              |
| to stream                                  | emitir                          | diffuser                          | streamen                               |                                                                                                                                       |
| Go live (button)                           | Emitir                          | Passer en direct                  | Live gaan                              | As the web (whose nl button says _Ga live_; buttons here are infinitives).                                                            |
| Stop (button)                              | Detener                         | Arrêter                           | Stoppen                                | es: never use _detenido_ for anything else, to avoid a clash with this button.                                                        |
| live (state)                               | en directo                      | en direct                         | live                                   |                                                                                                                                       |
| on air                                     | en directo                      | à l'antenne                       | live                                   |                                                                                                                                       |
| On air {duration} (ended)                  | Duración: {duration}            | Temps d'antenne {duration}        | Zendtijd {duration}                    | The literal _En directo / À l'antenne / Live_ under ENDED reads as still live. fr and nl say "airtime"; es has no airtime noun in 24. |
| press and hold                             | mantener pulsado                | maintenir appuyé                  | ingedrukt houden                       | nl: not _vasthouden_, which means holding the object itself.                                                                          |
| tap                                        | tocar                           | toucher                           | tikken (op)                            |                                                                                                                                       |
| Try again (sentence / button)              | Inténtalo de nuevo / Reintentar | Réessayez / Réessayer             | Probeer het opnieuw / Opnieuw proberen |                                                                                                                                       |
| code                                       | código                          | code                              | code                                   | The screens never say QR.                                                                                                             |
| expired, timed out (a code)                | caducado                        | expiré                            | verlopen                               | The operator's action is the same either way: get a new code.                                                                         |
| session                                    | sesión                          | session                           | sessie                                 |                                                                                                                                       |
| preview                                    | vista previa                    | aperçu                            | voorbeeld                              | As the web.                                                                                                                           |
| Score preview (the overlay)                | vista previa del marcador       | aperçu du score                   | scorevoorbeeld                         | The screens never say overlay.                                                                                                        |
| viewers                                    | el público                      | le public                         | kijkers                                | es and fr take the shorter word: the web's _espectadores, spectateurs_ do not fit the status line's 48.                               |
| What viewers see                           | Lo que ve el público            | Ce que voit le public             | Wat kijkers zien                       |                                                                                                                                       |
| organiser                                  | organizador                     | organisateur                      | organisator                            | As the web.                                                                                                                           |
| the desk                                   | la mesa                         | l'accueil                         | de balie                               | fr and nl as the web's "Scan at the desk".                                                                                            |
| phone                                      | móvil                           | téléphone                         | telefoon                               | es: Spain's word, as the web.                                                                                                         |
| camera, sound, mic                         | cámara, sonido, micro           | caméra, son, micro                | camera, geluid, microfoon              |                                                                                                                                       |
| network, signal, connection                | red, señal, conexión            | réseau, signal, connexion         | netwerk, signaal, verbinding           |                                                                                                                                       |
| link (Opening the link, backup link, Link) | enlace (conexión when opening)  | liaison                           | verbinding                             |                                                                                                                                       |
| Switched to backup link                    | Usando el enlace de reserva     | Basculé sur la liaison de secours | Overgeschakeld op reserveverbinding    | fr: _basculer_ is the failover verb.                                                                                                  |
| Uplink lost — holding                      | Sin conexión: esperando         | Liaison perdue : en attente       | Verbinding weg: wachten                |                                                                                                                                       |
| restarting                                 | reiniciando                     | relance                           | herstart                               | One word in all three restart lines.                                                                                                  |
| Viewers not receiving                      | No llega al público             | Rien n'arrive au public           | Kijkers ontvangen niets                | The same phrase with and without the countdown.                                                                                       |
| stalled (video)                            | congelado                       | figée                             | staat stil                             |                                                                                                                                       |
| stalled (delivery)                         | atascado                        | bloqué                            | vastgelopen                            |                                                                                                                                       |
| slate (the phone-made still on air)        | imagen fija                     | image fixe                        | pauzebeeld                             | Not the broadcast jargon _placa, carton, kaart_.                                                                                      |
| code scanner                               | escáner de códigos              | lecteur de codes                  | codescanner                            |                                                                                                                                       |
| Home (the screen)                          | Inicio                          | Accueil                           | Home                                   | fr: _l'Accueil_, capitalised, is the screen; _l'accueil_ is the desk.                                                                 |
| Settings                                   | Ajustes                         | Paramètres                        | Instellingen                           | fr: Android's and the web's word; _Réglages_ is iOS's.                                                                                |
| Diagnostics                                | Diagnóstico                     | Diagnostic                        | Diagnose                               |                                                                                                                                       |
| heartbeat                                  | latido                          | battement                         | hartslag                               | As the web.                                                                                                                           |
| session record                             | registro de la sesión           | journal de session                | sessielogboek                          |                                                                                                                                       |
| Delivery (Diagnostics section)             | Entrega                         | Réception                         | Ontvangst                              | fr: not _Diffusion_, the mode's word. nl: _Levering_ is goods delivery.                                                               |
| Round trip (Diagnostics)                   | Ida y vuelta                    | Aller-retour                      | Pingtijd                               | nl: _Rondreis_ is a touring holiday.                                                                                                  |
| Heat (Diagnostics) and its grades          | Temperatura: normal … crítica   | Température : normale … critique  | Warmte: normaal … kritiek              | es and fr grades agree with the feminine label (_alta, élevée_), not with the phone (_caliente, chaud_).                              |
| {chip}: ready / not ready (screen reader)  | {chip}: OK / pendiente          | {chip} : OK / en attente          | {chip}: klaar / niet klaar             | es and fr: _listo, prêt_ would have to agree with Cámara and Red; these forms do not inflect.                                         |
| Ready (the plate)                          | Listo                           | Prêt                              | Klaar                                  |                                                                                                                                       |
| Power (Settings)                           | Batería                         | Alimentation                      | Stroom                                 |                                                                                                                                       |
| plug in                                    | enchufar                        | brancher                          | aansluiten                             | es: _conectar_ also means the network. Say what to plug in.                                                                           |
| Continue (a mode)                          | Continuar                       | Reprendre                         | Verder met / Doorgaan                  |                                                                                                                                       |
| slot (camera position in a session)        | posición                        | emplacement                       | positie                                | As the web's slots (lineup, progression).                                                                                             |
| app                                        | app                             | app                               | app                                    |                                                                                                                                       |

## Translation review

- **New or changed English copy.** Add the key to es, fr and nl in the same
  change, and give each dictionary you touched the marker
  `"_review": "pending translation review"`. `pnpm i18n:release-check`
  refuses a release while any dictionary carries a `_review` key; development
  builds and CI ignore it.
- **Clearing the marker.** An AI review pass replaces the native-speaker
  review the S0 spec (§6, R11) required. This is the owner's ruling of
  2026-10-01. The pass checks every pending string against en, where and how
  it renders in `src/`, this glossary and the budgets. It corrects the string,
  removes the marker, and adds any new term to this file in the same change.
