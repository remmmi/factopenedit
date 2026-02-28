# fact_openedit

App Electron pour telecharger et gerer les factures du SaaS OpenEdit.

## Contexte

- Association avec 500+ factures/an sur OpenEdit (SaaS emailing/campagnes)
- Le telechargement natif est penible -> cette app automatise et organise
- 2-3 utilisateurs (bureau de l'asso)

## Stack

- Electron 40.6.1 + Electron Forge 7.11.1 (webpack-typescript)
- TypeScript 5.4.5 (strict mode)
- better-sqlite3 12.6.2 (DB locale)
- pdf-parse 1.1.1 (extraction texte PDF -- v2 cassee pour Node.js)
- HTML/CSS vanilla (pas de framework frontend)
- Jest + ts-jest (tests unitaires)

## Architecture

- `src/main/` : process principal (auth, download, DB, PDF parsing)
- `src/renderer/` : UI (HTML/CSS/TS vanilla)
- `src/shared/` : types partages
- `pdf_download/` : PDFs telecharges (gitignore)

## Constantes en dur (src/main/main.ts)

- `TENANT_ID = 79`
- `BASE_URL = 'https://saisie.open-edit.io'`
- `DOWNLOAD_DIR = <app>/pdf_download/` (cree automatiquement)

## Modele d'URL factures

```
https://saisie.open-edit.io/invoices/79/{year}/79-{year}-{seq:04d}.pdf
```

- seq = numero global continu, zero-padded 4 digits
- L'annee change dans le path ET le nom de fichier
- Le scan se definit par segments {year, from, to}

## Conventions

- TypeScript strict
- Pas de framework frontend
- DB synchrone (better-sqlite3)
- Pas d'emojis ni caracteres Unicode decoratifs dans le code
- Repondre en francais

## Points techniques notables

- `pdf-parse` : importer `require('pdf-parse/lib/pdf-parse.js')` et NON `pdf-parse`
  (l'index.js v1 tente d'ouvrir un fichier de test au demarrage -> crash Electron)
- `better-sqlite3` : les params nommes rejettent `undefined`, toujours passer `null`
- `net.request` avec `useSessionCookies: true` : partage les cookies du BrowserWindow, contourne CORS
- Progress scan : push main -> renderer via `webContents.send('scan:progress', ...)`

## Etat du projet

- [x] Workspace setup (scaffold, structure, deps, TS strict)
- [x] url-generator -- generateur d'URLs par segments {year, from, to} (7 tests)
- [x] db -- schema SQLite invoices/settings/scan_ranges, CRUD (13 tests)
- [x] pdf-parser -- extraction date/montant/statut acquitte depuis PDF reel
- [x] auth -- BrowserWindow login OAuth2 saisie.open-edit.io + detection session
- [x] downloader -- scan segments, HEAD check + GET PDF, onProgress callback
- [x] main.ts -- handlers IPC, init DB, cycle de vie Electron
- [x] preload.ts -- contextBridge window.api
- [x] UI -- bento grid, tableau factures filtre, scan avec progression, session
- [ ] Test flux complet avec vrais credentials (login -> scan -> download -> parse)
