# Workspace Setup - fact_openedit

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Mettre en place l'espace de travail Electron Forge avec TypeScript, la structure de fichiers, et les dependances -- sans code metier.

**Architecture:** Electron Forge avec template TypeScript plain (pas webpack/vite -- c'est du vanilla HTML/CSS). Structure src/main, src/renderer, src/shared. DB via better-sqlite3, PDF via pdf-parse.

**Tech Stack:** Electron Forge, TypeScript strict, better-sqlite3, pdf-parse

---

### Task 1: Scaffold Electron Forge

Le dossier contient deja des fichiers (CLAUDE.md, docs/, .git). On doit initialiser Electron Forge dans un dossier temporaire puis deplacer les fichiers pour ne pas ecraser ce qui existe.

**Files:**
- Create: `package.json`, `tsconfig.json`, `forge.config.ts`, `src/main.ts`, `src/renderer.ts`, `src/preload.ts`, `src/index.html`, `src/index.css`

**Step 1: Scaffold dans un dossier temporaire**

```bash
cd /home/m/Modèles
npx create-electron-app@latest fact_openedit_tmp --template=typescript
```

Attendu: dossier `fact_openedit_tmp/` cree avec le scaffold Electron Forge.

**Step 2: Copier les fichiers du scaffold dans le projet**

```bash
# Copier tout sauf .git et les fichiers qu'on a deja
cp -rn /home/m/Modèles/fact_openedit_tmp/* /home/m/Modèles/fact_openedit/
cp -rn /home/m/Modèles/fact_openedit_tmp/.* /home/m/Modèles/fact_openedit/ 2>/dev/null || true
```

Ne pas ecraser : `.git/`, `.gitignore`, `CLAUDE.md`, `docs/`

**Step 3: Nettoyer le dossier temporaire**

```bash
rm -rf /home/m/Modèles/fact_openedit_tmp
```

**Step 4: Verifier que l'app demarre**

```bash
cd /home/m/Modèles/fact_openedit
npm start
```

Attendu: une fenetre Electron s'ouvre avec le contenu par defaut "Hello World".

**Step 5: Commit**

```bash
git add -A
git commit -m "scaffold: electron forge typescript template"
```

---

### Task 2: Reorganiser la structure de fichiers

Deplacer les fichiers du scaffold dans la structure cible : `src/main/`, `src/renderer/`, `src/shared/`.

**Files:**
- Move: `src/main.ts` -> `src/main/main.ts`
- Move: `src/preload.ts` -> `src/main/preload.ts`
- Move: `src/renderer.ts` -> `src/renderer/app.ts`
- Move: `src/index.html` -> `src/renderer/index.html`
- Move: `src/index.css` -> `src/renderer/styles.css`
- Create: `src/shared/types.ts`
- Create: `src/main/auth.ts`
- Create: `src/main/downloader.ts`
- Create: `src/main/pdf-parser.ts`
- Create: `src/main/db.ts`
- Create: `src/main/url-generator.ts`
- Create: `data/.gitkeep`

**Step 1: Creer les dossiers**

```bash
mkdir -p src/main src/renderer src/shared data
```

**Step 2: Deplacer les fichiers existants**

```bash
mv src/main.ts src/main/main.ts
mv src/preload.ts src/main/preload.ts
mv src/renderer.ts src/renderer/app.ts
mv src/index.html src/renderer/index.html
mv src/index.css src/renderer/styles.css
```

**Step 3: Creer les fichiers placeholder**

Chaque fichier contient juste un commentaire de description et un export vide pour que TypeScript compile.

`src/shared/types.ts`:
```typescript
// Types partages entre main et renderer process
export {};
```

`src/main/auth.ts`:
```typescript
// Module d'authentification OpenEdit via BrowserWindow
export {};
```

`src/main/downloader.ts`:
```typescript
// Module de telechargement des factures PDF
export {};
```

`src/main/pdf-parser.ts`:
```typescript
// Module d'extraction d'infos depuis les PDFs
export {};
```

`src/main/db.ts`:
```typescript
// Module SQLite - schema et requetes
export {};
```

`src/main/url-generator.ts`:
```typescript
// Generateur d'URLs de factures a partir de segments de plage
export {};
```

`data/.gitkeep`:
```
```

**Step 4: Mettre a jour les chemins dans forge.config.ts**

Adapter `forge.config.ts` pour pointer vers les nouveaux chemins :
- Entry point main : `src/main/main.ts`
- Preload : `src/main/preload.ts`

Les chemins exacts dependent du contenu genere par le scaffold -- adapter en fonction.

**Step 5: Mettre a jour les chemins dans package.json**

Le champ `"main"` doit pointer vers le fichier compile de `src/main/main.ts`.

**Step 6: Mettre a jour les imports dans main.ts**

Adapter le chemin vers `index.html` et `preload.ts` dans `src/main/main.ts` pour refleter la nouvelle structure.

**Step 7: Mettre a jour tsconfig.json si necessaire**

Verifier que les `include`/`exclude` couvrent bien `src/main`, `src/renderer`, `src/shared`.

**Step 8: Verifier que l'app demarre**

```bash
npm start
```

Attendu: la fenetre Electron s'ouvre comme avant.

**Step 9: Commit**

```bash
git add -A
git commit -m "refactor: reorganiser structure src/main, src/renderer, src/shared"
```

---

### Task 3: Installer les dependances metier

**Files:**
- Modify: `package.json`

**Step 1: Installer better-sqlite3 et ses types**

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

Attendu: `better-sqlite3` dans dependencies, `@types/better-sqlite3` dans devDependencies.

Note: `better-sqlite3` est un module natif. `electron-rebuild` (inclus dans Electron Forge) doit le recompiler. Verifier que ca compile sans erreur.

**Step 2: Installer pdf-parse et ses types**

```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

**Step 3: Verifier que l'app demarre toujours**

```bash
npm start
```

Attendu: la fenetre s'ouvre sans erreur. Les modules natifs sont bien compiles.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: ajouter better-sqlite3 et pdf-parse"
```

---

### Task 4: Configurer TypeScript strict

**Files:**
- Modify: `tsconfig.json`

**Step 1: Activer le mode strict**

S'assurer que `tsconfig.json` contient au minimum :

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInImports": true,
    "resolveJsonModule": true
  }
}
```

Garder les options deja presentes du scaffold, juste s'assurer que `strict: true` est la.

**Step 2: Verifier la compilation**

```bash
npx tsc --noEmit
```

Attendu: zero erreur.

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "config: typescript strict mode"
```

---

### Task 5: Configurer le .gitignore final et nettoyer

**Files:**
- Modify: `.gitignore`

**Step 1: Fusionner le .gitignore existant avec celui du scaffold**

Le `.gitignore` final doit couvrir :

```
node_modules/
dist/
out/
.webpack/
.vite/
data/
!data/.gitkeep
*.db
*.db-journal
.env
.DS_Store
Thumbs.db
```

**Step 2: Verifier l'etat git**

```bash
git status
```

Attendu: rien de sensible dans le staging (pas de node_modules, pas de .env).

**Step 3: Commit**

```bash
git add .gitignore data/.gitkeep
git commit -m "config: gitignore final et data/.gitkeep"
```

---

### Task 6: Verification finale

**Step 1: Verifier la structure**

```bash
find src -type f | sort
```

Attendu:
```
src/main/auth.ts
src/main/db.ts
src/main/downloader.ts
src/main/main.ts
src/main/pdf-parser.ts
src/main/preload.ts
src/main/url-generator.ts
src/renderer/app.ts
src/renderer/index.html
src/renderer/styles.css
src/shared/types.ts
```

**Step 2: Verifier que l'app compile et demarre**

```bash
npm start
```

Attendu: fenetre Electron s'ouvre.

**Step 3: Verifier que le build fonctionne**

```bash
npm run make
```

Attendu: build reussi dans `out/`.

**Step 4: Commit final si necessaire**

```bash
git log --oneline
```

Attendu: 5-6 commits propres.
