import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { toCloudProxyInput } from './cloud-route.js';
import { startCommunityFeed } from './community-feed.js';
import legacyMarkup from './legacy-ui.html?raw';
import './app.css';

const CLOUD_REQUEST_TIMEOUT_MS = 8000;

const STORAGE_KEYS = {
  preferences: 'thadingyut_prefs_v2',
  environment: 'thadingyut_env_v1',
  wishes: 'thadingyut_wishes_v2',
  streak: 'thadingyut_streak_v2',
};

function readLocalBundle() {
  const read = (key, fallback) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  return {
    preferences: read(STORAGE_KEYS.preferences, {}),
    environment: read(STORAGE_KEYS.environment, { mode: 'auto', manualTime: 18 }),
    wishes: read(STORAGE_KEYS.wishes, []),
    streak: read(STORAGE_KEYS.streak, { last: '', count: 0, total: 0 }),
  };
}

function applyCloudBundle(bundle) {
  for (const field of Object.keys(STORAGE_KEYS)) {
    if (bundle[field] !== null && bundle[field] !== undefined) {
      let value = bundle[field];
      if (field === 'wishes') {
        const local = readLocalBundle().wishes;
        const combined = [...(Array.isArray(value) ? value : []), ...(Array.isArray(local) ? local : [])];
        value = [...new Map(combined.filter(w => w && typeof w.text === 'string').map(w => [w.id || `${w.text}:${w.at}`, w])).values()];
        value.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
      }
      window.localStorage.setItem(STORAGE_KEYS[field], JSON.stringify(value));
    }
  }
}

export default function App() {
  const [syncStatus, setSyncStatus] = useState('Preparing the lantern sky…');
  const [communityStatus, setCommunityStatus] = useState('အများဆုတောင်းများ ဖတ်နေသည်…');

  useEffect(() => {
    let disposed = false;
    let syncTimer;
    let client;
    let ownerId;
    let listener;
    let cloudActive = false;
    let usingLocalFallback = false;
    const cloudAbortController = new AbortController();
    let resolveInitialSky;
    const initialSkyReady = new Promise(resolve => { resolveInitialSky = resolve; });
    let initialSkyTimer = window.setTimeout(() => resolveInitialSky(), CLOUD_REQUEST_TIMEOUT_MS);
    const stopCommunityFeed = startCommunityFeed({
      onWishes: (wishes) => {
        if (disposed) return;
        window.__thadingyutCommunityWishes = wishes;
        window.clearTimeout(initialSkyTimer);
        resolveInitialSky();
        window.dispatchEvent(new CustomEvent('thadingyut:community-wishes', { detail: wishes }));
        setCommunityStatus(`အများဆုတောင်း ${wishes.length} ခု`);
      },
      onError: () => {
        window.clearTimeout(initialSkyTimer);
        resolveInitialSky();
        if (!disposed) setCommunityStatus('အများဆုတောင်း ချိတ်ဆက်မှု ပြန်ကြိုးစားနေသည်…');
      },
    });

    const setStatus = (value) => {
      if (!disposed) setSyncStatus(value);
    };

    const withCloudTimeout = (operation, label) => {
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(`${label} timed out after ${CLOUD_REQUEST_TIMEOUT_MS} ms.`)),
          CLOUD_REQUEST_TIMEOUT_MS,
        );
      });
      return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => {
        window.clearTimeout(timeoutId);
      });
    };

    const startScene = async () => {
      try {
        await import('./legacy.js');
      } catch (error) {
        console.error('Unable to start the lantern scene.', error);
        const loader = document.getElementById('loader');
        if (loader) loader.classList.add('hide');
        document.body.classList.add('scene-unavailable');
        document.querySelectorAll('button, input, textarea').forEach((control) => {
          control.disabled = true;
        });
        const notice = document.createElement('div');
        notice.className = 'scene-error';
        notice.setAttribute('role', 'status');
        notice.textContent = 'The 3D lantern scene could not start in this browser. Please try a browser with WebGL enabled.';
        document.body.appendChild(notice);
      }
    };

    const useLocalMode = (error) => {
      if (usingLocalFallback) return;
      usingLocalFallback = true;
      cloudActive = false;
      window.clearTimeout(syncTimer);
      if (listener) {
        window.removeEventListener('thadingyut:data-change', listener);
        listener = undefined;
      }
      if (!cloudAbortController.signal.aborted) cloudAbortController.abort();
      client = undefined;
      ownerId = undefined;
      console.warn('Cloud sync failed; continuing with local storage.', error?.message ?? error);
      setStatus('Saved on this device');
    };

    const saveCloudState = async () => {
      if (!cloudActive || !client || !ownerId) return;
      setStatus('Saving to cloud…');
      try {
        const { error } = await withCloudTimeout(
          () => client
            .from('thadingyut_profiles')
            .upsert(
              {
                owner_id: ownerId,
                ...readLocalBundle(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'owner_id' },
            ),
          'Cloud save',
        );
        if (error) throw error;
        if (cloudActive) setStatus('Cloud sync active');
      } catch (error) {
        useLocalMode(error);
      }
    };

    const cloudFetch = async (input, init = {}) => {
      const requestController = new AbortController();
      const signals = [init.signal, cloudAbortController.signal].filter(Boolean);
      const abortRequest = () => {
        if (!requestController.signal.aborted) requestController.abort();
      };
      for (const signal of signals) {
        if (signal.aborted) abortRequest();
        else signal.addEventListener('abort', abortRequest, { once: true });
      }
      try {
        const response = await fetch(toCloudProxyInput(input, window.location.origin), { ...init, signal: requestController.signal });
        if (!response.ok && !(response.headers.get('content-type') || '').includes('json')) {
          throw new Error(`Cloud API unavailable (HTTP ${response.status}). Check the deployed API functions.`);
        }
        return response;
      } finally {
        for (const signal of signals) signal.removeEventListener('abort', abortRequest);
      }
    };

    const boot = async () => {
      try {
        await withCloudTimeout(async () => {
          const configResponse = await cloudFetch('/api/config', { cache: 'no-store' });
          if (!configResponse.ok) throw new Error('Cloud configuration is unavailable.');
          const { supabaseUrl, supabaseKey } = await configResponse.json();
          if (usingLocalFallback || disposed) return;
          if (!supabaseUrl || !supabaseKey) throw new Error('Cloud configuration is incomplete.');
          // Keep the original Supabase storage key so existing anonymous users
          // retain access to their own profile after migrating to the proxy.
          const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
          client = createClient(`${window.location.origin}/api/supabase`, supabaseKey, {
            auth: {
              storageKey: `sb-${projectRef}-auth-token`,
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: false,
            },
            global: { fetch: cloudFetch },
          });

          const { data: sessionData, error: sessionError } = await client.auth.getSession();
          if (usingLocalFallback || disposed) return;
          if (sessionError) throw sessionError;
          let session = sessionData.session;
          if (!session?.user) {
            const { data, error } = await client.auth.signInAnonymously();
            if (usingLocalFallback || disposed) return;
            if (error) throw error;
            session = data.session;
          }
          if (!session?.user?.id) throw new Error('Anonymous session was not created.');
          ownerId = session.user.id;

          const { data: profile, error: loadError } = await client
            .from('thadingyut_profiles')
            .select('preferences, environment, wishes, streak')
            .eq('owner_id', ownerId)
            .maybeSingle();
          if (usingLocalFallback || disposed) return;
          if (loadError) throw loadError;
          if (profile) applyCloudBundle(profile);

          const { error: seedError } = await client
            .from('thadingyut_profiles')
            .upsert(
              {
                owner_id: ownerId,
                ...readLocalBundle(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'owner_id' },
            );
          if (usingLocalFallback || disposed) return;
          if (seedError) throw seedError;
        }, 'Cloud startup');

        if (!usingLocalFallback && !disposed) {
          cloudActive = true;
          listener = () => {
            window.clearTimeout(syncTimer);
            syncTimer = window.setTimeout(saveCloudState, 650);
          };
          window.addEventListener('thadingyut:data-change', listener);
          setStatus('Cloud sync active');
        }
      } catch (error) {
        useLocalMode(error);
      }

      await initialSkyReady;
      if (!disposed) await startScene();
    };

    void boot();
    return () => {
      disposed = true;
      cloudActive = false;
      stopCommunityFeed();
      window.clearTimeout(initialSkyTimer);
      resolveInitialSky();
      window.clearTimeout(syncTimer);
      if (listener) window.removeEventListener('thadingyut:data-change', listener);
      if (!cloudAbortController.signal.aborted) cloudAbortController.abort();
    };
  }, []);

  return (
    <>
      <div className="legacy-mount" dangerouslySetInnerHTML={{ __html: legacyMarkup }} />
      <div className="cloud-status" aria-live="polite">{communityStatus} · {syncStatus}</div>
    </>
  );
}
