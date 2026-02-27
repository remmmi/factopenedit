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
- pdf-parse 2.4.5 (extraction texte PDF)
- HTML/CSS vanilla (pas de framework frontend)

## Architecture

- `src/main/` : process principal (auth, download, DB, PDF parsing)
- `src/renderer/` : UI (HTML/CSS/TS vanilla)
- `src/shared/` : types partages
- `data/` : DB SQLite + PDFs telecharges (gitignore)

## Modele d'URL factures

```
https://openedit.io/invoices/{tenant_id}/{year}/{tenant_id}-{year}-{seq:04d}.pdf
```

- tenant_id fixe (configurable, ex: 79)
- year = annee d'emission
- seq = numero global continu, zero-padded 4 digits
- L'annee tourne dans le path ET le nom de fichier

## Conventions

- TypeScript strict
- Pas de framework frontend
- DB synchrone (better-sqlite3)
- Pas d'emojis ni caracteres Unicode decoratifs dans le code
- Repondre en francais

## Etat du projet

- [x] Workspace setup (scaffold, structure, deps, TS strict)
- [ ] url-generator -- generateur d'URLs de factures par segments {year, from, to}
- [ ] auth -- BrowserWindow login OpenEdit + cookies
- [ ] downloader -- telechargement PDF via net.request
- [ ] pdf-parser -- extraction date, montant, statut acquitte
- [ ] db -- schema SQLite (invoices, settings, scan_ranges)
- [ ] UI renderer -- tableau factures, panneau scan, settings

Prochaine etape suggeree : url-generator (testable sans credentials)

## Docs

- Design : `docs/plans/2026-02-28-fact-openedit-design.md`
- Plan setup : `docs/plans/2026-02-28-workspace-setup.md`

## Premier lancement

Le workspace n'a pas encore ete teste avec `npm start` (pas de display dispo lors du setup).
Verifier au premier lancement que webpack compile et que la fenetre s'ouvre.
