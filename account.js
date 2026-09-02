(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const dialog = byId('accountDialog');
  const button = byId('accountButton');
  const initials = byId('accountInitials');
  const providers = { google: byId('googleSignIn'), apple: byId('appleSignIn') };
  const config = window.SYNAP_AUTH_CONFIG;
  let controller;

  function render(state) {
    const signedIn = Boolean(state.user);
    button.classList.toggle('signed-in', signedIn);
    button.setAttribute('aria-label', signedIn ? 'Open your account' : 'Sign in to synap');
    byId('accountIcon').style.display = signedIn ? 'none' : '';
    initials.hidden = !signedIn;
    initials.textContent = signedIn ? (state.user.name || state.user.email || 'S').trim().slice(0, 1).toLocaleUpperCase() : '';
    byId('accountTitle').textContent = signedIn ? 'Your account' : 'Welcome to synap';
    byId('accountIdentity').hidden = !signedIn;
    byId('accountName').textContent = state.user?.name || 'synap member';
    byId('accountEmail').textContent = state.user?.email || '';
    byId('accountEmail').hidden = !state.user?.email;
    byId('accountProviders').hidden = signedIn;
    for (const [name, control] of Object.entries(providers)) {
      control.hidden = !state.providers[name];
      control.disabled = state.status !== 'ready' || state.busy;
    }
    byId('accountSignOut').hidden = !signedIn;
    byId('accountSignOut').disabled = state.busy;
    byId('accountRetry').hidden = state.status !== 'error';
    byId('accountLater').textContent = signedIn ? 'Done' : 'Not now';
    // Keep dismissal available even when the provider window is slow or cancelled.
    const message = state.status === 'unavailable' ? 'Sign-in isn’t available yet.' :
      state.status === 'loading' ? 'Loading sign-in…' : state.message;
    byId('accountStatus').textContent = message;
    byId('accountStatus').hidden = !message;
    byId('accountProviders').setAttribute('aria-busy', String(state.busy || state.status === 'loading'));
  }

  controller = window.SynapAuth.createController({
    config,
    loadAdapter: async firebase => {
      let timer;
      try {
        return await Promise.race([
          window.SynapAuth.loadFirebaseAdapter(firebase),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 15000); })
        ]);
      } finally { clearTimeout(timer); }
    },
    render,
    online: () => navigator.onLine !== false,
    canSignIn: () => document.dispatchEvent(new CustomEvent('synap:account-request', { cancelable: true }))
  });
  button.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
    if (controller.snapshot().status === 'error') controller.start();
  });
  byId('closeAccountButton').addEventListener('click', () => dialog.close());
  byId('accountLater').addEventListener('click', () => dialog.close());
  byId('accountRetry').addEventListener('click', () => controller.start());
  for (const [name, control] of Object.entries(providers)) control.addEventListener('click', () => controller.signIn(name));
  byId('accountSignOut').addEventListener('click', () => controller.signOut());
  window.addEventListener('online', () => { if (controller.snapshot().status === 'error') controller.start(); });
  controller.start();
})();
