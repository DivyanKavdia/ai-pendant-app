/* Optional accounts. This module never reads or uploads recordings or device IDs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SynapAuth = api;
})(globalThis, function () {
  'use strict';

  function isConfigured(config) {
    const firebase = config?.firebase;
    return ['apiKey', 'authDomain', 'projectId', 'appId'].every(key =>
      typeof firebase?.[key] === 'string' && firebase[key].trim().length > 0
    ) && (config.providers?.google === true || config.providers?.apple === true);
  }

  function messageFor(error) {
    switch (error?.code) {
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request': return '';
      case 'auth/popup-blocked': return 'Allow pop-ups, then try again.';
      case 'auth/network-request-failed': return 'Check your connection and try again.';
      case 'auth/account-exists-with-different-credential': return 'Use the sign-in option you used before.';
      case 'auth/user-disabled': return 'This account is unavailable.';
      case 'auth/too-many-requests': return 'Please wait a moment and try again.';
      case 'auth/operation-not-allowed':
      case 'auth/unauthorized-domain':
      case 'auth/invalid-api-key': return 'Sign-in is temporarily unavailable.';
      default: return 'Couldn’t sign in. Please try again.';
    }
  }

  function createController({ config, loadAdapter, render, canSignIn = () => true, online = () => true }) {
    const enabled = isConfigured(config);
    let adapter, unsubscribe, starting;
    const state = { status: enabled ? 'loading' : 'unavailable', user: null, busy: false, message: '' };
    function snapshot() {
      return { ...state, user: state.user ? { ...state.user } : null,
        providers: { google: enabled && config.providers.google === true, apple: enabled && config.providers.apple === true } };
    }
    const emit = () => render(snapshot());
    function changed(user) {
      // Only the authentication SDK supplies identity; no app-managed profile cache.
      state.user = user ? { uid: user.uid, name: user.displayName || '', email: user.email || '' } : null;
      state.status = 'ready';
      state.message = '';
      emit();
    }
    async function start() {
      if (!enabled || adapter) { emit(); return; }
      if (starting) return starting;
      state.status = 'loading'; state.message = ''; emit();
      starting = (async () => {
        try {
          adapter = await loadAdapter(config.firebase);
          unsubscribe = adapter.subscribe(changed);
          changed(adapter.currentUser());
        } catch (_) {
          unsubscribe?.(); unsubscribe = null; adapter = null;
          state.status = 'error';
          state.message = online() ? 'Couldn’t load sign-in. Try again.' : 'Connect to the internet to sign in.';
          emit();
        } finally { starting = null; }
      })();
      return starting;
    }
    async function signIn(provider) {
      if (!adapter || state.status !== 'ready' || state.busy || state.user || config.providers[provider] !== true || !['google', 'apple'].includes(provider)) return;
      if (!online()) { state.message = 'Connect to the internet to sign in.'; emit(); return; }
      if (!canSignIn()) { state.message = 'Finish recording or updating before signing in.'; emit(); return; }
      state.busy = true; state.message = 'Signing in…'; emit();
      try {
        // Invoke synchronously within the button gesture, without awaiting SDK loading.
        await adapter.signIn(provider);
        changed(adapter.currentUser());
      } catch (error) { state.message = messageFor(error); }
      finally { state.busy = false; emit(); }
    }
    async function signOut() {
      if (!adapter || state.busy || !state.user) return;
      state.busy = true; state.message = ''; emit();
      try { await adapter.signOut(); changed(adapter.currentUser()); }
      catch (_) { state.message = 'Couldn’t sign out. Please try again.'; }
      finally { state.busy = false; emit(); }
    }
    emit();
    return { start, signIn, signOut, snapshot };
  }

  async function loadFirebaseAdapter(config, loadModules = () => Promise.all([
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js')
  ])) {
    // Pin both modules to the same official SDK release. Never precache OAuth traffic.
    const [appSDK, authSDK] = await loadModules();
    const app = appSDK.getApps().find(app => app.name === 'synap-account') || appSDK.initializeApp(config, 'synap-account');
    const auth = authSDK.getAuth(app);
    authSDK.useDeviceLanguage(auth);
    await auth.authStateReady();
    return {
      currentUser: () => auth.currentUser,
      subscribe: callback => authSDK.onAuthStateChanged(auth, callback),
      signIn: name => {
        const provider = name === 'google' ? new authSDK.GoogleAuthProvider() : new authSDK.OAuthProvider('apple.com');
        if (name === 'google') provider.setCustomParameters({ prompt: 'select_account' });
        else { provider.addScope('email'); provider.addScope('name'); }
        return authSDK.signInWithPopup(auth, provider);
      },
      signOut: () => authSDK.signOut(auth)
    };
  }

  return { isConfigured, messageFor, createController, loadFirebaseAdapter };
});
