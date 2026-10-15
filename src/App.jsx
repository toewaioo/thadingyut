import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import legacyMarkup from './legacy-ui.html?raw';
import './app.css';

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
      window.localStorage.setItem(STORAGE_KEYS[field], JSON.stringify(bundle[field]));
    }
  }
}

export default function App() {
  const [syncStatus, setSyncStatus] = useState('Preparing the lantern sky…');

  useEffect(() => {
    let disposed = false;
    let syncTimer;
    let client;
    let ownerId;
    let listener;

    const setStatus = (value) => {
      if (!disposed) setSyncStatus(value);
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

    const saveCloudState = async () => {
      if (!client || !ownerId) return;
      setStatus('Saving to cloud…');
      const { error } = await client
        .from('thadingyut_profiles')
        .upsert(
          {
            owner_id: ownerId,
            ...readLocalBundle(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'owner_id' },
        );
      if (error) {
        console.warn('Cloud save failed; local data is preserved.', error.message);
        setStatus('Saved on this device');
      } else {
        setStatus('Cloud sync active');
      }
    };

    const boot = async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        setStatus('Saved on this device');
        await startScene();
        return;
      }

      try {
        client = createClient(supabaseUrl, supabaseKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        });

        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        let session = sessionData.session;
        if (!session?.user) {
          const { data, error } = await client.auth.signInAnonymously();
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
        if (loadError) throw loadError;
        if (profile) applyCloudBundle(profile);

        listener = () => {
          window.clearTimeout(syncTimer);
          syncTimer = window.setTimeout(saveCloudState, 650);
        };
        window.addEventListener('thadingyut:data-change', listener);

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
        if (seedError) throw seedError;
        setStatus('Cloud sync active');
      } catch (error) {
        console.warn('Supabase is unavailable; keeping this session local.', error.message);
        setStatus('Saved on this device');
        client = undefined;
        ownerId = undefined;
      }

      await startScene();
    };

    void boot();
    return () => {
      disposed = true;
      window.clearTimeout(syncTimer);
      if (listener) window.removeEventListener('thadingyut:data-change', listener);
    };
  }, []);

  return (
    <>
      <div className="legacy-mount" dangerouslySetInnerHTML={{ __html: legacyMarkup }} />
      <div className="cloud-status" aria-live="polite">{syncStatus}</div>
    </>
  );
}
