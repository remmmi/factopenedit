// Module d'authentification OpenEdit via BrowserWindow
import { BrowserWindow, session } from 'electron';
import { DEFAULT_BASE_URL } from './url-generator';

export interface AuthSession {
  cookies: Electron.Cookie[];
  // Header Cookie pret a l'emploi pour net.request
  cookieHeader: string;
}

/**
 * Ouvre une fenetre de login OpenEdit et attend que l'user se soit authentifie.
 *
 * Flux OAuth2 :
 *   /connexion -> /auth/apidae_auth -> login.plateforme.apidae-tourisme.com (Auth0)
 *   -> redirect vers saisie.open-edit.io/ (succes)
 *
 * Les cookies de session sont stockes dans session.defaultSession par Chromium.
 * Toutes les requetes net.request subsequentes les utilisent automatiquement.
 *
 * @returns Promise<AuthSession> - resout quand le login est termine
 */
export function openLoginWindow(baseUrl: string = DEFAULT_BASE_URL): Promise<AuthSession> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Connexion OpenEdit',
      webPreferences: {
        // Pas de preload ni de nodeIntegration dans la fenetre de login --
        // c'est une fenetre web pure, on ne veut pas exposer Node.js au site externe
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Detecte quand la navigation aboutit sur l'instance OpenEdit (post-login)
    // On exclut la page de connexion elle-meme et les URLs Apidae/Auth0
    win.webContents.on('did-navigate', async (_event, url) => {
      const isOnOpenEdit = url.startsWith(baseUrl);
      const isLoginPage = url.includes('/connexion') || url.includes('/auth/');
      console.log(`[auth] did-navigate: ${url} | onOpenEdit=${isOnOpenEdit} isLogin=${isLoginPage}`);

      if (isOnOpenEdit && !isLoginPage) {
        // Auth reussie -- recuperer les cookies du domaine OpenEdit
        try {
          const domain = new URL(baseUrl).hostname;
          const cookies = await session.defaultSession.cookies.get({ domain });
          console.log(`[auth] cookies apres login (${cookies.length}):`, cookies.map(c => c.name).join(', '));

          const cookieHeader = cookies
            .map((c) => `${c.name}=${c.value}`)
            .join('; ');

          win.removeAllListeners('closed');
          win.close();
          resolve({ cookies, cookieHeader });
        } catch (err) {
          reject(err);
        }
      }
    });

    win.on('closed', () => {
      // L'user a ferme la fenetre manuellement sans se connecter
      reject(new Error('Fenetre de connexion fermee par l\'utilisateur'));
    });

    win.loadURL(`${baseUrl}/connexion`);
  });
}

/**
 * Verifie si une session est toujours valide en testant un endpoint protege.
 * Retourne true si le cookie de session est encore accepte par OpenEdit.
 */
export async function isSessionValid(
  baseUrl: string = DEFAULT_BASE_URL
): Promise<boolean> {
  return new Promise((resolve) => {
    // On fait une requete HEAD sur la page d'accueil :
    // - 200 = session valide
    // - 302 vers /connexion = session expiree
    const request = require('electron').net.request({
      method: 'HEAD',
      url: `${baseUrl}/`,
      useSessionCookies: true, // utilise les cookies de session.defaultSession
    });

    request.on('response', (response: Electron.IncomingMessage) => {
      const location = response.headers['location'];
      console.log(`[auth] isSessionValid: status=${response.statusCode} location=${location}`);
      // Session valide si 200, ou si redirect vers autre chose que /connexion (ex: /factures)
      const redirectsToLogin =
        typeof location === 'string' && location.includes('/connexion');
      resolve(response.statusCode === 200 || (typeof location === 'string' && !redirectsToLogin));
    });

    request.on('error', () => resolve(false));
    request.end();
  });
}
