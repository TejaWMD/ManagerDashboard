/**
 * Deployment & Version Synchronization Manager for WM Manager Dashboard.
 *
 * Detects when a new version of the portal has been deployed to GitHub Pages or the hosting server:
 * 1. Inspects the server's version.json / build timestamp against __APP_BUILD_TIME__.
 * 2. Compares the server's index.html main JavaScript asset hash against the currently executing script.
 * 3. Checks navigator.serviceWorker for pending updates or waiting workers.
 *
 * If a new deployment is detected, clears caches and triggers a hard reload to activate the update.
 */

declare const __APP_BUILD_TIME__: number;

/**
 * Returns the build timestamp baked into the current running JavaScript bundle.
 * Falls back to 0 in development.
 */
export function getCurrentAppBuildTime(): number {
  try {
    return typeof __APP_BUILD_TIME__ === 'number' ? __APP_BUILD_TIME__ : 0;
  } catch {
    return 0;
  }
}

/**
 * Returns the filename of the primary script bundle currently loaded in the DOM
 * (e.g., "index-Cpitvs3Y.js").
 */
export function getCurrentScriptBundle(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
    for (const s of scripts) {
      const match = s.src.match(/index-[a-zA-Z0-9_-]+\.js/);
      if (match) return match[0];
    }
  } catch {
    // Ignore DOM query errors
  }
  return null;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  reason?: string;
  serverBuildTime?: number;
  serverBundle?: string;
}

/**
 * Checks the server to see if a newer version of the dashboard has been deployed.
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (typeof window === 'undefined') {
    return { hasUpdate: false };
  }

  // 1. Service Worker Update Check
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.waiting || reg.installing) {
          return {
            hasUpdate: true,
            reason: 'Service worker updated on server',
          };
        }
      }
    }
  } catch (err) {
    console.debug('[VersionManager] Service worker check skipped:', err);
  }

  // 2. version.json Timestamp Check
  const currentBuildTime = getCurrentAppBuildTime();
  try {
    const cacheBuster = `_t=${Date.now()}`;
    const versionUrl = `./version.json?${cacheBuster}`;
    const res = await fetch(versionUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (res.ok) {
      const data = await res.json();
      const serverTime = Number(data?.buildTime || data?.version);
      if (
        !Number.isNaN(serverTime) &&
        serverTime > 0 &&
        currentBuildTime > 0 &&
        serverTime > currentBuildTime
      ) {
        return {
          hasUpdate: true,
          reason: `New build deployed (${new Date(serverTime).toLocaleTimeString()})`,
          serverBuildTime: serverTime,
        };
      }
    }
  } catch (err) {
    console.debug('[VersionManager] version.json check skipped:', err);
  }

  // 3. index.html Script Bundle Hash Check (Bulletproof fallback for GitHub Pages)
  const currentBundle = getCurrentScriptBundle();
  if (currentBundle) {
    try {
      const cacheBuster = `_t=${Date.now()}`;
      const indexUrl = `./?${cacheBuster}`;
      const res = await fetch(indexUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      });

      if (res.ok) {
        const html = await res.text();
        const match = html.match(/index-[a-zA-Z0-9_-]+\.js/);
        if (match && match[0] && match[0] !== currentBundle) {
          return {
            hasUpdate: true,
            reason: `New bundle deployed (${match[0]})`,
            serverBundle: match[0],
          };
        }
      }
    } catch (err) {
      console.debug('[VersionManager] index.html hash check skipped:', err);
    }
  }

  return { hasUpdate: false };
}

/**
 * Clears service worker caches, notifies waiting workers, and reloads the browser to activate the new deployment.
 */
export async function applyAppUpdate(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    // 1. Clear any CacheStorage caches held by Service Worker or browser
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Ignore cache clear errors
  }

  try {
    // 2. Tell any waiting Service Worker to skipWaiting immediately
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }
  } catch {
    // Ignore SW postMessage errors
  }

  // 3. Clean hard reload
  window.location.reload();
}
