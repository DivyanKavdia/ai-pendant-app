/* Apply before first paint; appearance is independent of recording settings. */
(function () {
  'use strict';
  const key = 'synap-appearance';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = valid(localStorage.getItem(key)); } catch (_) {}
  function apply() {
    const mode = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#100f1a' : '#f6f4ff');
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference));
    });
  }
  function bind() {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => {
        preference = valid(button.dataset.themeChoice);
        try { localStorage.setItem(key, preference); } catch (_) {}
        apply();
      });
    });
    apply();
  }
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); }
  });
  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();
})();
