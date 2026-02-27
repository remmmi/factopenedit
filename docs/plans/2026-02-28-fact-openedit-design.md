# fact_openedit - Design Document

Date: 2026-02-28

## Contexte

Application Electron pour gerer les factures generees par le SaaS OpenEdit (plateforme d'emailing/campagnes avec abonnements payants pour une association). Le telechargement des factures depuis OpenEdit n'est pas ergonomique -- cette app automatise le process et fournit un suivi local.

Destinee a 2-3 personnes du bureau de l'asso. Volume : 500+ factures/an.

## Modele d'URL des factures

```
https://openedit.io/invoices/{tenant_id}/{year}/{tenant_id}-{year}-{seq:04d}.pdf
```

- `tenant_id` : identifiant du compte (ex: 79), configurable dans les settings
- `year` : annee d'emission de la facture
- `seq` : numero sequentiel zero-padded sur 4 digits (0001-9999)
- Le numero sequentiel est **global et continu** d'une annee sur l'autre
- L'annee change dans le path ET dans le nom de fichier simultanement

Exemple de sequence :
```
/invoices/79/2025/79-2025-0998.pdf
/invoices/79/2025/79-2025-0999.pdf
/invoices/79/2026/79-2026-1000.pdf   <- changement d'annee
/invoices/79/2026/79-2026-1001.pdf
```

## Architecture

### Approche retenue : Electron + BrowserWindow auth

- Le main process ouvre une BrowserWindow sur la page login d'OpenEdit
- L'user se connecte normalement
- Les cookies de session sont captures via `session.defaultSession.cookies`
- Les telechargements se font via `net.request` dans le main process (pas de CORS)

### Stack technique

- **Runtime** : Electron (derniere stable)
- **Langage** : TypeScript
- **DB** : SQLite via `better-sqlite3` (synchrone, zero config)
- **PDF parsing** : `pdf-parse` pour extraction texte
- **Build/packaging** : Electron Forge
- **UI** : HTML/CSS vanilla (pas de framework frontend)

### Structure du projet

```
fact_openedit/
  src/
    main/              # Process principal Electron
      main.ts          # Entry point, gestion fenetre, IPC
      auth.ts          # BrowserWindow login + cookies
      downloader.ts    # Telechargement factures via net.request
      pdf-parser.ts    # Extraction infos des PDFs
      db.ts            # SQLite - schema et requetes
      url-generator.ts # Generation d'URLs a partir de segments de plage
    renderer/          # Interface utilisateur
      index.html
      styles.css
      app.ts           # Logique UI
    shared/            # Types partages main/renderer
      types.ts
  data/                # DB SQLite + PDFs telecharges (gitignore)
  docs/plans/          # Design docs
```

## Modules

### 1. Auth (`auth.ts`)

- Ouvre une BrowserWindow sur l'URL de login OpenEdit
- Detecte la reussite du login via `did-navigate` (redirect vers dashboard)
- Les cookies restent dans la session Electron
- Si cookies expires -> re-ouvre la fenetre login
- Pas de stockage de credentials cote app

### 2. URL Generator / Range Scanner (`url-generator.ts`, `downloader.ts`)

**Generateur d'URLs :**
- L'user definit des **segments** : liste de `{year, from, to}`
- Exemple : `[{year: 2025, from: 980, to: 999}, {year: 2026, from: 1000, to: 1100}]`
- Le tenant_id est global (settings), pas dans la definition des segments
- L'annee est synchronisee dans le path ET le nom de fichier
- **Preview** : affichage de toutes les URLs generees avant tout scan

**Scanner :**
- Pour chaque URL generee : HEAD request d'abord (verification rapide)
- Si 200 -> GET pour telecharger le PDF
- Si 404 -> marquer comme inexistant, continuer
- Telechargement sequentiel avec delai configurable (eviter rate-limiting)
- PDFs stockes dans `data/invoices/{year}/79-{year}-{seq}.pdf`
- Pas d'automatisation au debut : tout est declanche manuellement par l'user

### 3. PDF Parser (`pdf-parser.ts`)

- `pdf-parse` extrait le texte brut du PDF
- Regex pour identifier :
  - Date d'emission
  - Montant
  - Mention "acquitte" / "paye" ou equivalent
- Le texte brut est stocke en DB pour debug et recherche future
- Les patterns regex seront affines une fois les vrais PDFs disponibles

### 4. Base de donnees (`db.ts`)

```sql
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    openedit_id INTEGER NOT NULL,           -- Numero sequentiel (ex: 1091)
    year INTEGER NOT NULL,                  -- Annee dans l'URL (ex: 2026)
    file_path TEXT,                         -- Chemin local du PDF
    issue_date TEXT,                        -- Date d'emission (extraite du PDF)
    amount_cents INTEGER,                   -- Montant en centimes
    is_paid BOOLEAN DEFAULT 0,             -- Acquittee ou pas
    status TEXT DEFAULT 'downloaded',       -- downloaded | sent_to_accountant
    downloaded_at TEXT NOT NULL,            -- Date de telechargement
    sent_at TEXT,                           -- Date d'envoi au comptable
    raw_text TEXT,                          -- Texte brut extrait du PDF
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(openedit_id, year)
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- Cles : base_url, tenant_id, download_dir

CREATE TABLE scan_ranges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    range_start INTEGER NOT NULL,
    range_end INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',          -- pending | scanning | completed
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 5. Interface utilisateur (renderer/)

**Ecran principal :**
- Tableau des factures : N. OpenEdit | Annee | Date emission | Montant | Acquittee | Statut | Actions
- Filtres : par annee, par statut (toutes / non envoyees / envoyees), par acquittement
- Actions par facture : ouvrir PDF, marquer "envoye au comptable"

**Panneau de scan :**
- Definition de segments de plage (annee + from/to)
- Preview des URLs generees
- Bouton "Lancer le scan"
- Barre de progression pendant le scan

**Settings :**
- URL de base OpenEdit
- Tenant ID
- Dossier de stockage des PDFs
- Bouton "Se connecter a OpenEdit"

## Contraintes et decisions

- **Pas de CORS** : les requetes partent du main process Electron, pas du renderer
- **Auth via BrowserWindow** : l'user se connecte dans une vraie fenetre web, pas de reverse-engineering du formulaire de login
- **Scan manuel d'abord** : pas d'automatisation, l'user controle les plages et voit les URLs avant de scanner
- **Packaging pour distribution** : Electron Forge, build pour 2-3 personnes du bureau
- **Pas d'envoi automatique au comptable** : c'est un statut manuel dans l'app
