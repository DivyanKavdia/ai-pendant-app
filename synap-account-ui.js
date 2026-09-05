/* Settings wiring for the Synap account and memory provider.
 *
 * Kept separate from google-auth.js so the auth module stays testable without a
 * DOM, and separate from app.js so a settings change never risks the capture
 * path. Everything here degrades quietly: if the markup is missing, this file
 * does nothing rather than throwing during startup and taking the recorder
 * down with it.
 */
(function (root) {
  'use strict';

  var PREF_KEY = 'synap-ai-provider-settings';

  function el(id) {
    return root.document ? root.document.getElementById(id) : null;
  }

  function prefs() {
    try {
      return JSON.parse(root.localStorage.getItem(PREF_KEY) || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function savePrefs(next) {
    var merged = Object.assign(prefs(), next);
    root.localStorage.setItem(PREF_KEY, JSON.stringify(merged));
    return merged;
  }

  function bind() {
    var provider = el('providerInput');
    var accountFields = el('synapAccountFields');
    var customFields = el('customEndpointFields');
    var form = el('settingsForm');
    if (!provider || !accountFields || !customFields || !form) return;

    var signIn = el('synapSignInButton');
    var signOut = el('synapSignOutButton');
    var buttonHost = el('synapSignInButtonHost');
    var nameEl = el('synapAccountName');
    var emailEl = el('synapAccountEmail');
    var statusEl = el('synapAccountStatus');
    var backendInput = el('synapBackendUrlInput');
    var clientInput = el('synapClientIdInput');
    var connection = el('synapConnectionDetails');

    var auth = root.SynapAuth;
    if (!auth) return;

    function status(message, kind) {
      if (!statusEl) return;
      statusEl.textContent = message || '';
      statusEl.dataset.kind = kind || '';
    }

    function applyProvider() {
      var usingSynap = provider.value === 'synap';
      accountFields.hidden = !usingSynap;
      customFields.hidden = usingSynap;
      if (usingSynap && root.SynapBackend) root.SynapBackend.mirrorEndpoints();
    }

    function renderSession(session) {
      var signedIn = Boolean(session && session.refreshToken);
      if (signIn) signIn.hidden = signedIn;
      if (signOut) signOut.hidden = !signedIn;
      if (buttonHost && signedIn) buttonHost.hidden = true;

      var profile = session && session.profile;
      if (nameEl) nameEl.textContent = signedIn ? (profile && profile.name) || 'Signed in' : 'Not signed in';
      if (emailEl) {
        emailEl.textContent = signedIn
          ? (profile && profile.email) || 'Your memories sync and stay encrypted.'
          : 'Sign in with Google to build your second brain.';
      }
    }

    /* Load stored connection settings into the fields. */
    var settings = auth.config();
    if (backendInput) backendInput.value = settings.backendUrl || '';
    if (clientInput) clientInput.value = settings.clientId || '';

    /* A backend URL and a client ID are deployment configuration, not user
       settings. When the build ships them as defaults there is nothing here a
       person should be asked to fill in, so the panel stays hidden and signing
       in is a single tap. It appears only when configuration is genuinely
       missing — a fork, a self-hosted backend, or a build without defaults —
       or when sign-in fails in a way that points at these values. */
    function revealConnection(force) {
      if (!connection) return;
      var configured = Boolean(settings.backendUrl && settings.clientId);
      connection.hidden = configured && !force;
      if (force) connection.open = true;
    }
    revealConnection(false);

    /* ai-providers.js defaults an unset preference to 'openai' and would then
       intercept every job looking for a key this build no longer asks for.
       Write the choice down explicitly so both modules agree on first run. */
    var stored = prefs().provider;
    if (stored !== 'synap' && stored !== 'openai' && stored !== 'custom') {
      stored = 'synap';
      savePrefs({ provider: stored });
    }
    provider.value = stored === 'synap' ? 'synap' : 'custom';
    applyProvider();

    provider.addEventListener('change', function () {
      savePrefs({ provider: provider.value });
      applyProvider();
    });

    auth.onChange(renderSession);

    if (signIn) {
      signIn.addEventListener('click', function () {
        /* Persist connection settings before signing in, so a first-run user
           does not have to press Save and then Sign in in the right order. */
        try {
          settings = auth.saveConfig({
            backendUrl: backendInput ? backendInput.value : '',
            clientId: clientInput ? clientInput.value : ''
          });
        } catch (error) {
          status(error.message, 'error');
          revealConnection(true);
          return;
        }

        status('Opening Google Sign-In…');
        signIn.disabled = true;

        auth.signIn().then(function () {
          status('Signed in. Your memories will sync from now on.', 'ok');
        }).catch(function (error) {
          /* One Tap is routinely suppressed in installed PWAs and on iOS.
             Fall back to the explicit button rather than dead-ending. */
          if (error && error.message === 'one_tap_unavailable' && buttonHost) {
            buttonHost.hidden = false;
            buttonHost.innerHTML = '';
            status('Use the Google button below to continue.');
            auth.renderButton(buttonHost, function () {
              buttonHost.hidden = true;
              status('Signed in. Your memories will sync from now on.', 'ok');
            }, function (failure) {
              status(failure.message || 'Sign-in failed.', 'error');
            });
            return;
          }
          status((error && error.message) || 'Sign-in failed.', 'error');
          // Sign-in failure is the only time these values are worth showing.
          revealConnection(true);
        }).then(function () {
          signIn.disabled = false;
        }, function () {
          signIn.disabled = false;
        });
      });
    }

    if (signOut) {
      signOut.addEventListener('click', function () {
        signOut.disabled = true;
        auth.signOut().then(function () {
          status('Signed out on every device.', 'ok');
        }).catch(function () {
          status('Signed out on this device.', 'ok');
        }).then(function () {
          signOut.disabled = false;
        });
      });
    }

    /* Save connection settings with the rest of the form. Capture phase, so
       this runs before app.js validates the legacy endpoint fields. */
    form.addEventListener('submit', function () {
      savePrefs({ provider: provider.value });
      if (provider.value !== 'synap') return;
      try {
        settings = auth.saveConfig({
          backendUrl: backendInput ? backendInput.value : '',
          clientId: clientInput ? clientInput.value : ''
        });
        if (root.SynapBackend) root.SynapBackend.mirrorEndpoints();
        revealConnection(false);
      } catch (error) {
        status(error.message, 'error');
      }
    }, true);

    renderSession(auth.session());
  }

  if (root.document && root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  root.SynapAccountUI = { bind: bind };
})(globalThis);
