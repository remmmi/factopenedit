# Bugs fonctionnels a corriger

## B1 - Race condition au demarrage (CRITIQUE)

**Fichier:** src/main/main.ts:490-499
**Probleme:** Au `app.ready`, 4 operations async sont lancees en parallele sans `await` :
- 2x `backfillFromPdfDir` (insere des factures en DB)
- `backfillClientFields` (lit et met a jour des factures)
- `backfillAvoirFields` (lit et met a jour des factures)

Elles lisent et ecrivent toutes dans la meme DB simultanement. Si un scan utilisateur demarre pendant ces backfills, des collisions d'insertion sont possibles (avalees par les `catch {}` vides).

**Fix:** Chainer les backfills avec `await` dans une sequence ordonnee :
1. backfillFromPdfDir (ancien dossier)
2. backfillFromPdfDir (nouveau dossier)
3. backfillClientFields
4. backfillAvoirFields

---

## B2 - parseInt sans check NaN sur tenant_id

**Fichier:** src/main/main.ts:62
**Probleme:** Si la valeur `tenant_id` en DB est corrompue (string non-numerique), `parseInt` retourne `NaN`. `NaN` est un nombre donc truthy, et `tenantId` vaut `NaN`. Toutes les URLs generees seront invalides (`/invoices/NaN/...`) sans aucun message d'erreur.

**Fix:** Apres le `parseInt`, verifier `isNaN()` et rester a `null` si invalide. Logger un warning.

---

## B3 - Scan daily ne gere pas le changement d'annee

**Fichier:** src/main/main.ts:398-428
**Probleme:** Le scan daily utilise `Math.max(maxYear, currentYear)` comme annee du segment. Si on est en 2027 et que la derniere facture en DB est de 2026, le scan cherche les nouvelles seqs dans l'annee 2027 uniquement. Mais les premieres factures de 2027 peuvent encore etre dans le path URL 2026 (le serveur ne bascule pas forcement au 1er janvier).

**Fix:** Creer 2 segments si `maxYear < currentYear` : un pour `maxYear` et un pour `currentYear`. Ou utiliser le mode exploratoire (year=0) avec candidateYears couvrant les deux annees.

---

## B6 - YEAR_SWITCH_THRESHOLD duplique

**Fichier:** src/renderer/app.ts:62 et src/main/url-generator.ts:9
**Probleme:** La constante est definie a 2 endroits avec le commentaire "Doit etre identique". Si l'une change sans l'autre, le modal de confirmation affichera des bascules d'annee incorrectes par rapport au comportement reel du scan.

**Fix:** Exposer la constante via l'API IPC (preload) ou la deplacer dans src/shared/ pour qu'elle soit importee des deux cotes.

---

## B7 - Mode exploratoire avec candidateYears vide

**Fichier:** src/main/downloader.ts:160-163
**Probleme:** Si `segment.year === 0` et `candidateYears` est un tableau vide, `yearsDesc[0]` est `undefined`. `generateUrl(tenantId, undefined, ...)` produit des URLs cassees (`/invoices/79/undefined/...`) sans erreur.

**Fix:** Ajouter un guard au debut de la branche exploratoire : si `candidateYears` est vide, signaler une erreur via `onProgress` et passer au segment suivant.

---

## R1 - Aucun timeout sur les requetes HTTP

**Fichier:** src/main/downloader.ts:26-60
**Probleme:** `checkUrl` (HEAD) et `downloadPdf` (GET) n'ont aucun timeout. Si le serveur ne repond pas (connexion suspendue, firewall drop), la Promise reste en attente indefiniment. Un scan de 200 URLs peut se bloquer completement.

**Fix:** Ajouter un `setTimeout` qui appelle `req.abort()` apres un delai configurable (ex: 15s pour HEAD, 30s pour GET). Rejeter la Promise avec une erreur de timeout.

---

## R3 - Pas de protection contre scans concurrents

**Fichier:** src/main/main.ts (handlers scan:start, scan:daily, scan:initial)
**Probleme:** Rien n'empeche de lancer plusieurs scans en parallele (scan manuel + daily auto + initial). Chaque scan ecrit dans les memes fichiers PDF et la meme DB. Les insertions en doublon sont avalees, mais 2 scans peuvent ecrire le meme fichier PDF simultanement (corruption).

**Fix:** Ajouter un flag `scanInProgress` dans main.ts. Les handlers verifient ce flag et rejettent si un scan est deja en cours. Le renderer affiche un message "Scan deja en cours".

---

## U2 - Scan daily se lance sans verifier la session

**Fichier:** src/renderer/app.ts:939
**Probleme:** `performDailyCheck()` est lance automatiquement au demarrage apres `loadInvoices()`. Si la session OAuth2 est expiree, toutes les requetes echouent silencieusement (302 redirection vers login interpretee comme erreur/404). L'utilisateur n'a aucun retour.

**Fix:** Dans `performDailyCheck`, appeler `checkSession()` d'abord. Si la session est invalide, ne pas lancer le scan et afficher un indicateur dans l'UI (ex: badge "session expiree").

---

## U3 - "Vider" le panier ne remet pas le statut en DB

**Fichier:** src/renderer/app.ts:884-887
**Probleme:** Le bouton "Retirer" un item du panier appelle `unmarkSentToAccountant` (remet le statut a `downloaded` en DB). Mais le bouton "Vider" tout le panier ne fait que vider le tableau local `cartItems` sans toucher la DB. Les factures restent marquees `sent_to_accountant` en DB.

**Fix:** Dans le handler "Vider", boucler sur `cartItems` et appeler `unmarkSentToAccountant` pour chaque facture avant de vider le tableau.

---

## R2 - catch {} vides partout

**Fichier:** src/main/main.ts (lignes 148, 166, 189, 392, 493, 497-498)
**Probleme:** Les blocs `catch {}` et `.catch(() => {})` masquent toutes les erreurs, y compris les bugs de programmation (TypeError, ReferenceError). Le diagnostic est impossible quand quelque chose casse silencieusement.

**Fix:** Remplacer par `catch (err) { console.error('[contexte]', err); }` au minimum. Ne pas changer la logique, juste ajouter le log.

---

## U4 - Menu contextuel peut deborder du viewport

**Fichier:** src/renderer/app.ts:821-823
**Probleme:** Le menu contextuel est positionne a `clientX/clientY` sans verifier qu'il reste dans la fenetre. En bas a droite de l'ecran, le menu est coupe.

**Fix:** Apres positionnement, verifier `menu.getBoundingClientRect()` vs `window.innerWidth/innerHeight` et ajuster si necessaire.

---

## U5 - Pas de feedback si le scan echoue

**Fichier:** src/renderer/app.ts:486-496
**Probleme:** Si `startScan` leve une exception, le `finally` remet le bouton en etat mais aucun message d'erreur n'est affiche. L'erreur part seulement dans `console.error`.

**Fix:** Ajouter un `catch` qui affiche l'erreur dans `resultText` (ex: "Erreur : ...message...") avec une couleur rouge.
