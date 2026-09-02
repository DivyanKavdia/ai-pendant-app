/* Public Firebase web-app settings only. Never add a client secret or private key.
 * Enable each provider after its console setup is complete. See AUTH_SETUP.md. */
window.SYNAP_AUTH_CONFIG = Object.freeze({
  firebase: null,
  providers: { google: false, apple: false }
});
