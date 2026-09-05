/* Synap Google Sign-In.
 *
 * Flow:
 *   Google Identity Services  ->  Google ID token
 *   POST /v1/auth/google      ->  Synap access token (1h) + refresh token (30d)
 *   POST /v1/auth/refresh     ->  a new pair, without another Google prompt
 *
 * The exchange exists because a Google ID token from the browser flow lasts an
 * hour with no refresh path. Uploading a long capture would break the moment
 * the phone stayed locked past that hour, mid-conversation, which is precisely
 * when Synap must not fail. A Synap refresh token keeps the queue running.
 *
 * The refresh token is held in localStorage. That is a deliberate tradeoff:
 * this PWA is served from a different origin than the API, so an httpOnly
 * cookie would need SameSite=None and a credentialed CORS path, and the token
 * would still be usable by anything that can run script here. Instead the
 * server stamps each refresh token with a generation number, so signing out —
 * from any device — invalidates every outstanding token at once.
 */
(function (root) {
  'use strict';

  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var STORAGE_KEY = 'synap-auth-session-v1';
  var CONFIG_KEY = 'synap-backend-config-v1';

  /* Deployment defaults, overridable in Settings at runtime.
     The client ID is not a secret — it is public by design and ships in every
     Google Sign-In page. The backend URL is filled in after the first Cloud Run
     deploy prints it. */
  var DEFAULTS = {
    clientId: '435475937223-7d2lmg7oc0887tc8psbt8ikgn0jkm62q.apps.googleusercontent.com',
    backendUrl: 'https://synap-backend-435475937223.asia-south1.run.app'
  };

  var listeners = [];
  var gisPromise = null;
  var refreshPromise = null;

  function config() {
    try {
      var stored = JSON.parse(root.localStorage.getItem(CONFIG_KEY) || '{}');
      return {
        clientId: String(stored.clientId || DEFAULTS.clientId || '').trim(),
        backendUrl: String(stored.backendUrl || DEFAULTS.backendUrl || '').replace(/\/+$/, '')
      };
    } catch (error) {
      return { clientId: DEFAULTS.clientId, backendUrl: DEFAULTS.backendUrl };
    }
  }

  function saveConfig(next) {
    var merged = {
      clientId: String(next.clientId || '').trim(),
      backendUrl: String(next.backendUrl || '').replace(/\/+$/, '')
    };
    if (merged.backendUrl && new URL(merged.backendUrl).protocol !== 'https:') {
      throw new Error('The Synap backend URL must use HTTPS.');
    }
    root.localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
    return merged;
  }

  function readSession() {
    try {
      return JSON.parse(root.localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function writeSession(session) {
    if (session) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else root.localStorage.removeItem(STORAGE_KEY);
    listeners.forEach(function (listener) {
      try { listener(session); } catch (error) { /* a bad listener must not break auth */ }
    });
  }

  function onChange(listener) {
    listeners.push(listener);
    try { listener(readSession()); } catch (error) { /* ignore */ }
    return function () {
      listeners = listeners.filter(function (entry) { return entry !== listener; });
    };
  }

  /* Load the Google Identity Services script once, on demand. */
  function loadGis() {
    if (root.google && root.google.accounts && root.google.accounts.id) return Promise.resolve();
    if (gisPromise) return gisPromise;

    gisPromise = new Promise(function (resolve, reject) {
      var existing = root.document.querySelector('script[data-synap-gis]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('Google Sign-In failed to load.')); });
        return;
      }
      var script = root.document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-synap-gis', '1');
      script.onload = function () { resolve(); };
      script.onerror = function () {
        gisPromise = null;
        reject(new Error('Google Sign-In could not be reached. Check your connection.'));
      };
      root.document.head.appendChild(script);
    });
    return gisPromise;
  }

  function api(path, options) {
    var settings = config();
    if (!settings.backendUrl) {
      return Promise.reject(new Error('Add your Synap backend URL in Settings.'));
    }
    var init = options || {};
    return root.fetch(settings.backendUrl + path, {
      method: init.method || 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'X-Synap-Client': 'pwa', 'X-Synap-Schema': '1' },
        init.headers || {}
      ),
      body: init.body,
      signal: init.signal
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }
        if (!response.ok) {
          var message = (data && data.error && data.error.message) || ('HTTP ' + response.status);
          var failure = new Error(message);
          failure.status = response.status;
          failure.code = data && data.error && data.error.code;
          failure.retryable = Boolean(data && data.error && data.error.retryable);
          throw failure;
        }
        return data;
      });
    });
  }

  function storeTokens(tokens, profile) {
    var session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      /* Renew a minute early so a request never races its own expiry. */
      expiresAt: Date.now() + Math.max(0, (tokens.expires_in || 3600) - 60) * 1000,
      profile: profile || (readSession() || {}).profile || null
    };
    writeSession(session);
    return session;
  }

  /* Prompt for Google Sign-In and exchange the resulting ID token. */
  function signIn() {
    var settings = config();
    if (!settings.clientId) {
      return Promise.reject(new Error('Add your Google client ID in Settings.'));
    }

    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        var settled = false;
        root.google.accounts.id.initialize({
          client_id: settings.clientId,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: function (response) {
            if (settled) return;
            settled = true;
            if (!response || !response.credential) {
              reject(new Error('Google Sign-In returned no credential.'));
              return;
            }
            resolve(response.credential);
          }
        });

        root.google.accounts.id.prompt(function (notification) {
          /* One Tap can be suppressed by browser settings or a prior dismissal.
             Fall back to the explicit button rather than leaving the user
             staring at nothing. */
          if (settled) return;
          var blocked = notification &&
            ((notification.isNotDisplayed && notification.isNotDisplayed()) ||
             (notification.isSkippedMoment && notification.isSkippedMoment()));
          if (blocked) {
            settled = true;
            reject(new Error('one_tap_unavailable'));
          }
        });
      });
    }).then(function (credential) {
      return api('/v1/auth/google', { body: JSON.stringify({ id_token: credential }) });
    }).then(function (result) {
      var session = storeTokens(result, null);
      return me().then(function (profile) {
        session.profile = profile;
        writeSession(session);
        return session;
      }).catch(function () { return session; });
    });
  }

  /**
   * Render an explicit "Sign in with Google" button into a container. Used when
   * One Tap is unavailable, which is common in installed PWAs and on iOS.
   */
  function renderButton(container, onSuccess, onError) {
    var settings = config();
    if (!settings.clientId) {
      if (onError) onError(new Error('Add your Google client ID in Settings.'));
      return;
    }
    loadGis().then(function () {
      root.google.accounts.id.initialize({
        client_id: settings.clientId,
        callback: function (response) {
          if (!response || !response.credential) {
            if (onError) onError(new Error('Google Sign-In returned no credential.'));
            return;
          }
          api('/v1/auth/google', { body: JSON.stringify({ id_token: response.credential }) })
            .then(function (result) {
              var session = storeTokens(result, null);
              return me().then(function (profile) {
                session.profile = profile;
                writeSession(session);
                return session;
              }).catch(function () { return session; });
            })
            .then(function (session) { if (onSuccess) onSuccess(session); })
            .catch(function (error) { if (onError) onError(error); });
        }
      });
      root.google.accounts.id.renderButton(container, {
        theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260
      });
    }).catch(function (error) { if (onError) onError(error); });
  }

  function refresh() {
    var session = readSession();
    if (!session || !session.refreshToken) {
      return Promise.reject(new Error('Sign in to sync your memories.'));
    }
    /* Collapse concurrent refreshes: the processor runs several jobs at once
       and a burst of refreshes would rotate tokens under each other. */
    if (refreshPromise) return refreshPromise;

    refreshPromise = api('/v1/auth/refresh', {
      body: JSON.stringify({ refresh_token: session.refreshToken })
    }).then(function (tokens) {
      refreshPromise = null;
      return storeTokens(tokens, session.profile);
    }).catch(function (error) {
      refreshPromise = null;
      /* A revoked or expired refresh token is terminal: clear it so the UI
         asks for sign-in instead of retrying forever. */
      if (error.status === 401) writeSession(null);
      throw error;
    });
    return refreshPromise;
  }

  /* Return a currently valid access token, refreshing when needed. */
  function accessToken() {
    var session = readSession();
    if (!session) return Promise.reject(new Error('Sign in to sync your memories.'));
    if (session.accessToken && session.expiresAt > Date.now()) {
      return Promise.resolve(session.accessToken);
    }
    return refresh().then(function (next) { return next.accessToken; });
  }

  /* Authenticated fetch against the backend, retrying once after a refresh. */
  function authedFetch(path, options) {
    var init = options || {};
    return accessToken().then(function (token) {
      var settings = config();
      return root.fetch(settings.backendUrl + path, {
        method: init.method || 'GET',
        headers: Object.assign({
          Authorization: 'Bearer ' + token,
          'X-Synap-Client': 'pwa',
          'X-Synap-Schema': '1'
        }, init.headers || {}),
        body: init.body,
        signal: init.signal
      });
    }).then(function (response) {
      if (response.status !== 401 || init.__retried) return response;
      return refresh().then(function () {
        return authedFetch(path, Object.assign({}, init, { __retried: true }));
      });
    });
  }

  function me() {
    return authedFetch('/v1/auth/me').then(function (response) {
      if (!response.ok) throw new Error('Could not load your profile.');
      return response.json();
    });
  }

  function signOut() {
    var session = readSession();
    var done = session
      ? authedFetch('/v1/auth/signout', { method: 'POST' }).catch(function () { /* local sign-out still proceeds */ })
      : Promise.resolve();
    return done.then(function () {
      writeSession(null);
      if (root.google && root.google.accounts && root.google.accounts.id) {
        try { root.google.accounts.id.disableAutoSelect(); } catch (error) { /* ignore */ }
      }
    });
  }

  function isSignedIn() {
    var session = readSession();
    return Boolean(session && session.refreshToken);
  }

  root.SynapAuth = {
    config: config,
    saveConfig: saveConfig,
    signIn: signIn,
    signOut: signOut,
    renderButton: renderButton,
    refresh: refresh,
    accessToken: accessToken,
    authedFetch: authedFetch,
    me: me,
    session: readSession,
    isSignedIn: isSignedIn,
    onChange: onChange,
    STORAGE_KEY: STORAGE_KEY,
    CONFIG_KEY: CONFIG_KEY
  };
})(globalThis);
