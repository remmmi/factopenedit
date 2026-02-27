# fact_openedit

App Electron pour telecharger et gerer les factures du SaaS OpenEdit.

## Contexte

- Association avec 500+ factures/an sur OpenEdit (SaaS emailing/campagnes)
- Le telechargement natif est penible -> cette app automatise et organise
- 2-3 utilisateurs (bureau de l'asso)

## Stack

- Electron + Electron Forge
- TypeScript
- better-sqlite3 (DB locale)
- pdf-parse (extraction texte PDF)
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

## Design doc

Voir `docs/plans/2026-02-28-fact-openedit-design.md`
