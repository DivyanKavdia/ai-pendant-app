# Activate Synap accounts

The account interface and Firebase integration are implemented. Real sign-in is
disabled until a Firebase project and at least one provider are configured.
`auth-config.js` deliberately contains no example credentials that could be
mistaken for an active service. Hosting remains on GitHub Pages.

## Firebase and Google

1. Create or select a project in the [Firebase console](https://console.firebase.google.com/).
   Register a **Web app** in Project settings → Your apps. Analytics is not required.
2. Enable Authentication → Sign-in method → **Google** and set the support email.
   Complete the Google OAuth consent-screen configuration for the intended audience.
   If the OAuth application is in testing, add the people who will test sign-in.
3. Under Authentication → Settings → Authorized domains, add
   `divyankavdia.github.io` (a hostname, without the `/synap-pwa/` path).
   Keep the project's default Firebase auth domain authorized.
4. Copy the public web-app configuration into `auth-config.js`:

   ```js
   window.SYNAP_AUTH_CONFIG = Object.freeze({
     firebase: {
       apiKey: "<public web API key>",
       authDomain: "<project-id>.firebaseapp.com",
       projectId: "<project-id>",
       appId: "<web app ID>"
     },
     providers: { google: true, apple: false }
   });
   ```

   Use the exact values from Firebase. The public web API key identifies the
   project; it is not an administrative credential. Never put service-account
   JSON, OAuth client secrets or Apple private keys in this file or repository.

## Apple

1. In the Apple Developer account, enable Sign in with Apple on a primary App ID.
   Create a Services ID for the website and associate it with that App ID.
2. Configure the domain `<project-id>.firebaseapp.com` and Return URL
   `https://<project-id>.firebaseapp.com/__/auth/handler`.
3. Create a Sign in with Apple key. Enter the Services ID, Team ID, Key ID and
   private key directly in Firebase Authentication's **Apple** provider setup.
   These secrets belong in that console, not in the browser code or chat.
4. Enable Apple in Firebase, then set `providers.apple: true` in `auth-config.js`.
   Google can be activated first while Apple is being configured.

## Behavior and boundaries

- The profile icon opens an optional account sheet. **Not now** returns to the app.
  No account is created for guests and no signup prompt interrupts startup.
- The SDK restores its persisted session when browser storage permits. Login
  can still work with in-memory persistence when durable storage is unavailable.
  The app renders identity only from SDK auth state and never stores its own token
  or profile copy. Sign-out updates the profile, including across supported tabs.
- Both providers use popup authentication. The SDK is initialized before enabling
  the buttons, preserving the user gesture. Popups avoid navigating away from the
  recorder and avoid the cross-domain redirect-storage problem on GitHub Pages.
  If the browser blocks a popup, allow it and retry. Test the installed PWA on the
  target phones; provider login has not been tested against a live project yet.
- Sign-in cannot start during connecting, recording, saving, unsaved audio recovery
  or OTA transfer. Closing the account sheet remains possible during a slow login.
- The account is separate from local audio and pendant association. Signing in or
  out does not upload, delete, reassign, hide or sync recordings. Local recordings
  remain available to anyone using that browser. No cloud backup is claimed.
- Firebase handles account creation and provider verification. This release has
  no cloud data API, no provider-linking UI and no self-service account deletion;
  account deletion can be handled in Firebase Authentication's Users page.
  Do not infer account equality from email, including Apple relay addresses.
- No account token is sent to the configurable transcription/summary endpoints.
  A future account-backed API must verify Firebase ID tokens server-side and
  enforce access by UID. Merely rendering a signed-in profile is not authorization.
- Only app-owned scripts are precached. OAuth responses, SDK files and account
  traffic are excluded from the service-worker cache. If sign-in cannot load
  offline, the guest recording interface remains independent and usable.

## Release check

Run `node --test tests/*.cjs`. The authentication tests exercise both providers
through a mock SDK adapter, restored sessions, cancellation, blocked popups,
offline errors, retry, sign-out failure, guest dismissal, safe profile rendering
and the actual recording/OTA activity guard. Existing BLE/OTA tests still run.
These checks do not prove live OAuth configuration or real phone popup behavior.

After supplying config, increment the app-shell revision in `index.html`, `app.js`,
`sw.js` and the cache assertions in `tests/reconnect.cjs`. Deploy the complete shell
so existing installations receive the config. Do not clear site data to update.
Test Google and Apple login, reload, sign-out, cancel, offline use, both themes,
and login refusal during recording and OTA before enabling the providers broadly.

## Provider references

- [Firebase web setup](https://firebase.google.com/docs/web/setup)
- [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Apple sign-in and console configuration](https://firebase.google.com/docs/auth/web/apple)
- [Persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence)
- [Redirect limitations and popup alternative](https://firebase.google.com/docs/auth/web/redirect-best-practices)
- [Public Firebase API keys](https://firebase.google.com/docs/projects/api-keys)
