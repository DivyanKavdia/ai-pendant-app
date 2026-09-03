/* Apply before first paint; appearance is independent of recording settings. */
(function () {
  'use strict';
  const key = 'synap-appearance';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = valid(localStorage.getItem(key)); } catch (_) {}
  function installBrandStyles() {
    if (document.querySelector('link[data-synap-brand]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'brand.css?v=1.0.0-infinity1';
    link.dataset.synapBrand = 'infinity1';
    document.head.appendChild(link);
  }
  function apply() {
    const mode = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#100f1a' : '#f6f4ff');
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference));
    });
  }
  function addDeferredScript(src, onerror) {
    if (document.querySelector('script[src="' + src + '"]')) return;
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    if (onerror) script.onerror = onerror;
    document.head.appendChild(script);
  }
  function installAISettings() {
    if (typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') return;
    const fields = document.querySelector('.processing-fields');
    const endpoint = document.getElementById('endpointInput');
    const llmEndpoint = document.getElementById('llmEndpointInput');
    const token = document.getElementById('tokenInput');
    if (!fields || !endpoint || !llmEndpoint || !token || document.getElementById('providerInput')) return;

    const providerField = document.createElement('label');
    providerField.className = 'field';
    providerField.innerHTML = '<span>AI provider</span><select id="providerInput"><option value="openai">OpenAI</option><option value="custom">Custom / other provider</option></select><small>OpenAI needs only an API key. Custom mode keeps endpoint support.</small>';

    const modelFields = document.createElement('div');
    modelFields.id = 'openAIModelFields';
    modelFields.className = 'processing-fields';
    modelFields.innerHTML = '<label class="field"><span>Transcription model</span><select id="sttModelInput"><option value="gpt-4o-mini-transcribe">GPT-4o mini Transcribe</option><option value="gpt-4o-transcribe">GPT-4o Transcribe</option><option value="gpt-4o-transcribe-diarize">GPT-4o Transcribe Diarize</option></select></label><label class="field"><span>Meeting model</span><select id="llmModelInput"><option value="gpt-5-mini">GPT-5 mini</option><option value="gpt-5">GPT-5</option><option value="gpt-4.1-mini">GPT-4.1 mini</option></select><small>Used for ~5-minute context blocks and the final meeting memory.</small></label><label class="field"><span>Transcription language</span><select id="languageInput"><option value="auto">Auto detect</option><option value="en">English</option><option value="hi">Hindi</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ja">Japanese</option></select></label>';

    const custom = document.createElement('div');
    custom.id = 'customEndpointFields';
    custom.className = 'processing-fields';
    custom.append(endpoint.closest('label'), llmEndpoint.closest('label'));

    const tokenLabel = token.closest('label')?.querySelector('span');
    if (tokenLabel) {
      tokenLabel.id = 'apiKeyLabel';
      tokenLabel.textContent = 'OpenAI API key';
    }
    token.placeholder = 'sk-…';
    token.autocomplete = 'off';

    fields.prepend(providerField, modelFields, custom);

    addDeferredScript('ai-providers.js?v=1.0.0-ai2', () => {
      const status = document.getElementById('queueStatus');
      if (status) status.textContent = 'AI provider module could not load. Reload while online.';
    });
    addDeferredScript('recording-bridge.js?v=1.0.0-touch1');
  }
  function bind() {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => {
        preference = valid(button.dataset.themeChoice);
        try { localStorage.setItem(key, preference); } catch (_) {}
        apply();
      });
    });
    installAISettings();
    apply();
  }
  installBrandStyles();
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); }
  });
  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();
})();