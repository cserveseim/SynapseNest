(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const state = {
    csrfToken: '',
    aiConfigured: false,
    aiModel: '',
    working: false,
    runtimePhase: 'unknown'
  };

  const flash = (message, isError = false) => {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = isError ? 'show error' : 'show';
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { toast.className = ''; }, 3300);
  };

  async function request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (state.csrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrfToken;
    const response = await fetch(pathname, { credentials: 'same-origin', ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : undefined;
    if (body && body.csrfToken) state.csrfToken = body.csrfToken;
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
    return { response, body };
  }

  function rememberWorkspaceId(id) {
    if (id) document.body.dataset.aliveWorkspaceId = id;
  }

  function currentWorkspaceId() {
    const active = $('[data-workspace].active');
    if (active?.dataset?.workspace) {
      rememberWorkspaceId(active.dataset.workspace);
      return active.dataset.workspace;
    }
    return document.body.dataset.aliveWorkspaceId || null;
  }

  function hookFetchForWorkspaceId() {
    if (window.__aliveFetchHooked) return;
    window.__aliveFetchHooked = true;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await original(...args);
      try {
        const url = String(args[0]?.url || args[0] || '');
        const match = /\/api\/workspaces\/([0-9a-f-]{36})/i.exec(url);
        if (match) rememberWorkspaceId(match[1]);
      } catch { /* ignore */ }
      return res;
    };
  }

  function ensureAiHead() {
    const pane = $('.chat-pane');
    if (!pane) return null;
    let head = $('.alive-ai-head', pane);
    const old = pane.querySelector(':scope > .eyebrow');
    if (!head) {
      head = document.createElement('div');
      head.className = 'alive-ai-head';
      head.innerHTML = '<span class="eyebrow-text">GROK</span><span class="alive-ai-badge" id="aliveAiBadge">…</span>';
      if (old) old.replaceWith(head);
      else pane.insertBefore(head, pane.firstChild);
    }
    return $('#aliveAiBadge');
  }

  function ensureRuntimePill() {
    const meta = $('#workspaceMeta');
    if (!meta) return null;
    let pill = $('#aliveRuntimePill');
    if (!pill) {
      pill = document.createElement('span');
      pill.id = 'aliveRuntimePill';
      pill.className = 'alive-runtime-pill stopped';
      pill.textContent = 'stopped';
      meta.appendChild(document.createTextNode(' '));
      meta.appendChild(pill);
    }
    return pill;
  }

  function setRuntimePill(phase, label) {
    const pill = ensureRuntimePill();
    if (!pill) return;
    state.runtimePhase = phase;
    pill.className = `alive-runtime-pill ${phase}`;
    pill.textContent = label || phase;
  }

  function markPreviewLive(on) {
    const pip = $('#previewPip');
    if (!pip) return;
    pip.classList.toggle('alive-live', Boolean(on) && !pip.hidden);
  }

  function setActionBusy(busy, which) {
    const start = $('#start');
    const stop = $('#stop');
    if (start) {
      start.classList.toggle('alive-busy', busy && which === 'start');
      if (busy && which === 'start') {
        start.disabled = true;
        start.textContent = 'Starting…';
      } else if (!busy) {
        start.disabled = false;
        start.textContent = 'Start';
      }
    }
    if (stop) {
      stop.classList.toggle('alive-busy', busy && which === 'stop');
      if (busy && which === 'stop') {
        stop.disabled = true;
        stop.textContent = 'Stopping…';
      } else if (!busy) {
        stop.disabled = false;
        stop.textContent = 'Stop';
      }
    }
  }

  function syncRuntimeFromMeta() {
    const meta = $('#workspaceMeta');
    if (!meta) return;
    const text = (meta.childNodes[0]?.textContent || meta.textContent || '').toLowerCase();
    const pip = $('#previewPip');
    if (state.runtimePhase === 'starting' || state.runtimePhase === 'stopping') {
      if (text.includes('running') && state.runtimePhase === 'starting') {
        setRuntimePill('running', 'live');
        markPreviewLive(true);
        setActionBusy(false);
      } else if (!text.includes('running') && state.runtimePhase === 'stopping') {
        setRuntimePill('stopped', 'stopped');
        markPreviewLive(false);
        setActionBusy(false);
      }
      return;
    }
    if (text.includes('running') || (pip && !pip.hidden)) {
      setRuntimePill('running', 'live');
      markPreviewLive(true);
      setActionBusy(false);
    } else {
      setRuntimePill('stopped', 'stopped');
      markPreviewLive(false);
      setActionBusy(false);
    }
  }

  function setAiBadge(mode, label) {
    const badge = ensureAiHead();
    const status = $('#aiStatus');
    if (badge) {
      badge.className = `alive-ai-badge ${mode}`;
      badge.textContent = label;
    }
    if (status) {
      status.className = `ai-status alive-${mode === 'working' ? 'working' : mode === 'online' ? 'ready' : 'offline'}`;
      if (mode === 'working') status.textContent = label;
      else if (mode === 'online') status.textContent = `${state.aiModel || 'grok'} · ready — ask to create or edit files`;
      else status.textContent = label === 'sign in'
        ? 'Sign in to unlock Grok'
        : 'Grok offline — set XAI_API_KEY / Grok auth on server';
    }
    const pane = $('.chat-pane');
    if (pane) pane.classList.toggle('alive-ai-working', mode === 'working');
  }

  function renderEmptyState() {
    const log = $('#chatLog');
    if (!log || log.querySelector('.msg')) return;
    if ($('#aliveEmpty')) return;
    log.innerHTML = `<div class="alive-empty" id="aliveEmpty">
      <strong>Grok is ready to build in this workspace.</strong>
      <span>Describe a landing page, restyle files, or add a section. Writes go through the live <code>/api/workspaces/…/ai</code> endpoint.</span>
      <div class="alive-empty-actions">
        <button type="button" data-alive-prompt="Build a tight landing page with a headline, one CTA, and a dark canvas.">Create landing page</button>
        <button type="button" data-alive-prompt="Restyle the current files with a calmer palette and better type.">Restyle</button>
        <button type="button" data-alive-prompt="Add a second section under the hero with three short feature cards.">Add section</button>
      </div>
    </div>`;
  }

  function clearEmptyState() {
    const empty = $('#aliveEmpty');
    if (empty) empty.remove();
  }

  async function loadAiStatus() {
    try {
      const { body } = await request('/api/ai/status');
      state.aiConfigured = Boolean(body.configured);
      state.aiModel = body.model || 'grok-4.6';
      setAiBadge(state.aiConfigured ? 'online' : 'offline', state.aiConfigured ? state.aiModel : 'offline');
    } catch {
      setAiBadge('offline', 'unreachable');
    }
  }

  async function streamReveal(el, text) {
    const full = String(text || '');
    el.textContent = '';
    const node = document.createTextNode('');
    const caret = document.createElement('span');
    caret.className = 'alive-caret';
    el.appendChild(node);
    el.appendChild(caret);
    const chunk = Math.max(1, Math.ceil(full.length / 56));
    let i = 0;
    await new Promise((resolve) => {
      const tick = () => {
        i = Math.min(full.length, i + chunk);
        node.textContent = full.slice(0, i);
        const log = $('#chatLog');
        if (log) log.scrollTop = log.scrollHeight;
        if (i >= full.length) {
          caret.remove();
          resolve();
          return;
        }
        setTimeout(tick, 14);
      };
      tick();
    });
  }

  async function runAiTurn(prompt) {
    await bootstrapCsrf();
    const id = currentWorkspaceId();
    if (!id) throw new Error('Create or open a workspace first.');
    if (!state.aiConfigured) {
      await loadAiStatus();
      if (!state.aiConfigured) throw new Error('Grok is not configured on this server.');
    }
    if (state.working) return;

    const log = $('#chatLog');
    const send = $('#chatSend');
    const input = $('#chatInput');
    clearEmptyState();
    state.working = true;
    setAiBadge('working', 'Grok working…');
    if (send) {
      send.disabled = true;
      send.classList.add('alive-busy', 'alive-send-label');
      send.textContent = '…';
    }

    log.insertAdjacentHTML('beforeend', `<div class="msg user">${escapeHtml(prompt)}</div>`);
    const thinking = document.createElement('div');
    thinking.className = 'msg assistant alive-thinking';
    thinking.innerHTML = '<span class="alive-dots" aria-hidden="true"><span></span><span></span><span></span></span><span>Grok is editing the workspace…</span>';
    log.appendChild(thinking);
    log.scrollTop = log.scrollHeight;
    if (input) input.value = '';

    try {
      const { body } = await request(`/api/workspaces/${id}/ai`, {
        method: 'POST',
        body: JSON.stringify({ prompt })
      });
      thinking.remove();
      const bubble = document.createElement('div');
      bubble.className = 'msg assistant alive-streaming';
      log.appendChild(bubble);
      await streamReveal(bubble, body.reply || 'Done.');
      bubble.classList.remove('alive-streaming');

      const written = body.written || [];
      if (written.length) {
        log.insertAdjacentHTML('beforeend', `<div class="msg alive-meta">Updated · ${escapeHtml(written.join(', '))}</div>`);
      }
      if (Array.isArray(body.rejected) && body.rejected.length) {
        log.insertAdjacentHTML(
          'beforeend',
          `<div class="msg alive-error">Skipped · ${escapeHtml(body.rejected.map((r) => r.path).join(', '))}</div>`
        );
      }
      log.scrollTop = log.scrollHeight;
      flash(written.length ? `Grok updated ${written.join(', ')}.` : 'Grok replied.');

      const activeWs = document.querySelector(`[data-workspace="${id}"]`);
      if (activeWs) activeWs.click();
    } catch (error) {
      thinking.remove();
      log.insertAdjacentHTML('beforeend', `<div class="msg alive-error">${escapeHtml(error.message || 'Grok request failed.')}</div>`);
      log.scrollTop = log.scrollHeight;
      flash(error.message || 'Grok request failed.', true);
      throw error;
    } finally {
      state.working = false;
      if (send) {
        send.disabled = false;
        send.classList.remove('alive-busy');
        send.classList.add('alive-send-label');
        send.textContent = 'Run';
      }
      setAiBadge(state.aiConfigured ? 'online' : 'offline', state.aiConfigured ? state.aiModel : 'offline');
    }
  }

  function enhanceSendButton() {
    const send = $('#chatSend');
    if (!send) return;
    send.classList.add('alive-send-label');
    send.setAttribute('aria-label', 'Run Grok');
    send.title = 'Run Grok on this workspace';
    const t = send.textContent.trim();
    if (t === '↑' || t === '' || t === '…') send.textContent = 'Run';
  }

  function bindChat() {
    const form = $('#chatForm');
    if (!form || form.dataset.aliveBound) return;
    form.dataset.aliveBound = '1';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const prompt = ($('#chatInput')?.value || '').trim();
      if (!prompt) return;
      try { await runAiTurn(prompt); } catch { /* toasted */ }
    }, true);

    document.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-alive-prompt]');
      if (!btn) return;
      event.preventDefault();
      const prompt = btn.getAttribute('data-alive-prompt') || '';
      const input = $('#chatInput');
      if (input) input.value = prompt;
      runAiTurn(prompt).catch(() => {});
    });
  }

  function bindRuntime() {
    const start = $('#start');
    const stop = $('#stop');
    if (start && !start.dataset.aliveBound) {
      start.dataset.aliveBound = '1';
      start.addEventListener('click', () => {
        setRuntimePill('starting', 'starting');
        setActionBusy(true, 'start');
        markPreviewLive(false);
        [500, 1500, 3000, 5000].forEach((ms) => setTimeout(syncRuntimeFromMeta, ms));
      }, true);
    }
    if (stop && !stop.dataset.aliveBound) {
      stop.dataset.aliveBound = '1';
      stop.addEventListener('click', () => {
        setRuntimePill('stopping', 'stopping');
        setActionBusy(true, 'stop');
        [500, 1500, 3000].forEach((ms) => setTimeout(syncRuntimeFromMeta, ms));
      }, true);
    }
    const newWs = $('#newWorkspace');
    if (newWs && !newWs.dataset.aliveBound) {
      newWs.dataset.aliveBound = '1';
      newWs.addEventListener('click', () => {
        setRuntimePill('starting', 'creating');
        flash('Creating workspace — BusyBox starts on create.');
        [800, 2000, 4000].forEach((ms) => setTimeout(syncRuntimeFromMeta, ms));
      }, true);
    }
  }

  function observeWorkspace() {
    const meta = $('#workspaceMeta');
    if (meta) {
      new MutationObserver(() => {
        syncRuntimeFromMeta();
        const active = $('[data-workspace].active');
        if (active) rememberWorkspaceId(active.dataset.workspace);
      }).observe(meta, { childList: true, characterData: true, subtree: true });
    }
    document.addEventListener('click', (event) => {
      const ws = event.target.closest('[data-workspace]');
      if (ws?.dataset?.workspace) rememberWorkspaceId(ws.dataset.workspace);
    }, true);
    setInterval(() => {
      if ($('#workspaceStudio') && !$('#workspaceStudio').hidden) syncRuntimeFromMeta();
    }, 2500);
  }

  async function bootstrapCsrf() {
    try {
      const { body } = await request('/api/auth/session');
      if (body.csrfToken) state.csrfToken = body.csrfToken;
      return Boolean(body.authenticated);
    } catch {
      return false;
    }
  }

  async function init() {
    hookFetchForWorkspaceId();
    ensureAiHead();
    ensureRuntimePill();
    enhanceSendButton();
    bindChat();
    bindRuntime();
    observeWorkspace();
    renderEmptyState();

    const authed = await bootstrapCsrf();
    if (authed) await loadAiStatus();
    else setAiBadge('offline', 'sign in');

    const studio = $('#workspaceStudio');
    if (studio) {
      new MutationObserver(async () => {
        if (!studio.hidden) {
          await bootstrapCsrf();
          await loadAiStatus();
          enhanceSendButton();
          renderEmptyState();
          syncRuntimeFromMeta();
        }
      }).observe(studio, { attributes: true, attributeFilter: ['hidden'] });
    }
    syncRuntimeFromMeta();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
