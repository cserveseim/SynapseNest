(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = {
    csrfToken: '',
    workspaces: [],
    workspace: null,
    files: [],
    path: '',
    socket: null,
    pane: 'chat',
    pip: { x: null, y: null },
    dirty: false,
    monacoReady: null,
    editor: null,
    saveBaseline: '',
    /* BEGIN:XTERM_TERMINAL state */
    term: null,
    fitAddon: null,
    termWorkspaceId: null,
    termReconnectTimer: null,
    termReconnectAttempt: 0,
    termManualClose: false,
    termResizeObserver: null,
    termLastSize: { cols: 0, rows: 0 },
    /* END:XTERM_TERMINAL state */
  };

  const LANG_BY_EXT = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    json: 'json', html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', markdown: 'markdown',
    py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell',
    yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml',
    sql: 'sql', rs: 'rust', go: 'go', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
    php: 'php', rb: 'ruby', dockerfile: 'dockerfile',
    txt: 'plaintext', log: 'plaintext', env: 'ini', toml: 'ini', ini: 'ini',
    conf: 'ini', cfg: 'ini',
  };

  const flash = (message, isError = false) => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = isError ? 'show error' : 'show';
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { toast.className = ''; }, 3300);
  };

  const setAuthError = (message) => {
    const el = $('#authError');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  };

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function languageFromPath(filePath) {
    const base = String(filePath || '').split('/').pop() || '';
    if (/^Dockerfile$/i.test(base)) return 'dockerfile';
    if (/^\.env/i.test(base)) return 'ini';
    const ext = (base.includes('.') ? base.split('.').pop() : '').toLowerCase();
    return LANG_BY_EXT[ext] || 'plaintext';
  }

  function updateEditorLabel() {
    const label = $('#editorLabel');
    if (!label) return;
    const name = state.path || 'EDITOR';
    label.textContent = state.dirty ? `${name} ●` : name;
    label.classList.toggle('dirty', Boolean(state.dirty && state.path));
    const saveBtn = $('#save');
    if (saveBtn) saveBtn.classList.toggle('dirty', Boolean(state.dirty && state.path));
  }

  function setDirty(next) {
    state.dirty = Boolean(next);
    updateEditorLabel();
  }

  function getEditorValue() {
    return state.editor ? state.editor.getValue() : '';
  }

  function ensureMonaco() {
    if (state.monacoReady) return state.monacoReady;
    state.monacoReady = new Promise((resolve, reject) => {
      const boot = () => {
        try {
          // eslint-disable-next-line no-undef
          require.config({ paths: { vs: '/vendor/monaco/vs' } });
          // eslint-disable-next-line no-undef
          require(['vs/editor/editor.main'], () => {
            // eslint-disable-next-line no-undef
            if (!window.monaco) {
              reject(new Error('Monaco failed to load'));
              return;
            }
            resolve(window.monaco);
          }, (err) => reject(err || new Error('Monaco AMD load failed')));
        } catch (error) {
          reject(error);
        }
      };
      if (typeof require === 'function' && typeof require.config === 'function') {
        boot();
        return;
      }
      const existing = document.querySelector('script[src="/vendor/monaco/vs/loader.js"]');
      if (existing) {
        existing.addEventListener('load', boot);
        existing.addEventListener('error', () => reject(new Error('Monaco loader failed')));
        // loader may already be ready
        if (typeof require === 'function') boot();
        return;
      }
      const script = document.createElement('script');
      script.src = '/vendor/monaco/vs/loader.js';
      script.onload = boot;
      script.onerror = () => reject(new Error('Monaco loader failed'));
      document.head.appendChild(script);
    });
    return state.monacoReady;
  }

  async function initEditor() {
    const monaco = await ensureMonaco();
    const host = $('#editor');
    if (!host || state.editor) return state.editor;
    monaco.editor.defineTheme('synapsenest', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
        { token: 'string', foreground: '7dd3c0' },
        { token: 'keyword', foreground: '93c5fd' },
        { token: 'number', foreground: 'fbbf24' },
      ],
      colors: {
        'editor.background': '#090a0ecc',
        'editor.foreground': '#e8eaef',
        'editorLineNumber.foreground': '#4b5563',
        'editorLineNumber.activeForeground': '#9ca3af',
        'editor.selectionBackground': '#5eead426',
        'editor.inactiveSelectionBackground': '#5eead414',
        'editorCursor.foreground': '#5eead4',
        'editor.lineHighlightBackground': '#ffffff08',
        'editorWidget.background': '#0f1218',
        'editorSuggestWidget.background': '#0f1218',
        'scrollbarSlider.background': '#ffffff18',
        'scrollbarSlider.hoverBackground': '#ffffff28',
      },
    });
    state.editor = monaco.editor.create(host, {
      value: '',
      language: 'plaintext',
      theme: 'synapsenest',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      renderLineHighlight: 'line',
      padding: { top: 10, bottom: 10 },
      ariaLabel: 'File editor',
      readOnly: false,
    });
    state.editor.onDidChangeModelContent(() => {
      if (!state.path) {
        setDirty(false);
        return;
      }
      setDirty(getEditorValue() !== state.saveBaseline);
    });
    state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCurrentFile().catch((error) => {
        console.error(error);
        flash(error.message || 'Save failed.', true);
      });
    });
    return state.editor;
  }

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

  async function loadSession() {
    const { body } = await request('/api/auth/session');
    const authenticated = Boolean(body.authenticated);
    $('#authPanel').hidden = authenticated;
    $('#workspaceStudio').hidden = !authenticated;
    $('#logout').hidden = !authenticated;
    $('#ownerState').textContent = authenticated ? '● signed in' : body.owner ? '● locked' : '● set password';
    $('#authEyebrow').textContent = body.owner ? 'Sign in' : 'Set password';
    $('#authTitle').textContent = body.owner ? 'Owner password' : 'Create owner password';
    $('#authCopy').textContent = body.owner
      ? 'Unlock workspaces, terminal, and Grok.'
      : 'This password stays on the server.';
    $('#authSubmit').textContent = body.owner ? 'Sign in' : 'Create';
    $('#password').autocomplete = body.owner ? 'current-password' : 'new-password';
    setAuthError('');
    $('#crumb').textContent = authenticated ? 'workspace' : 'sign in';
    if (authenticated) {
      await initEditor();
      await loadAiStatus();
      await loadWorkspaces();
    }
  }

  async function loadAiStatus() {
    const { body } = await request('/api/ai/status');
    const status = $('#aiStatus');
    if (!status) return;
    status.textContent = body.configured ? `${body.model}` : 'Grok offline — no API key';
  }

  async function loadWorkspaces(selectId) {
    const { body } = await request('/api/workspaces');
    state.workspaces = body.workspaces || [];
    const selected = selectId || state.workspace?.id || state.workspaces[0]?.id;
    $('#workspaceList').innerHTML = state.workspaces.map((workspace) => (
      `<button class="project ${workspace.id === selected ? 'active' : ''}" data-workspace="${escapeHtml(workspace.id)}" type="button"><b>${escapeHtml(workspace.templateId)}</b><span>${escapeHtml(workspace.status)}</span></button>`
    )).join('') || '<p class="eyebrow">No workspaces — tap ＋</p>';
    if (selected) await openWorkspace(selected);
  }

  function setPreview(running, workspaceId) {
    const pip = $('#previewPip');
    const frame = $('#preview');
    if (running) {
      pip.hidden = false;
      frame.src = `/api/workspaces/${workspaceId}/preview/`;
    } else {
      pip.hidden = true;
      pip.classList.remove('expanded', 'minimized');
      frame.removeAttribute('src');
    }
  }

  async function openWorkspace(workspaceId) {
    const { body } = await request(`/api/workspaces/${workspaceId}`);
    state.workspace = body.workspace;
    $('#crumb').textContent = state.workspace.templateId;
    $('#workspaceTitle').textContent = state.workspace.templateId;
    $('#workspaceMeta').textContent = `${state.workspace.status} · ${state.workspace.selectedBranch}`;
    const { body: filesBody } = await request(`/api/workspaces/${workspaceId}/files`);
    state.files = filesBody.files || [];
    renderFiles();
    if (state.workspace.status === 'running') {
      setPreview(true, workspaceId);
      connectTerminal(workspaceId);
    } else {
      setPreview(false);
      disconnectTerminal();
    }
  }

  function renderFiles() {
    $('#fileTree').innerHTML = state.files.map((file) => (
      `<button type="button" data-path="${escapeHtml(file.path)}" class="${file.path === state.path ? 'active' : ''}">${escapeHtml(file.path)}</button>`
    )).join('');
  }

  async function openFile(relativePath) {
    if (state.dirty && state.path && state.path !== relativePath) {
      const proceed = window.confirm(`Discard unsaved changes to ${state.path}?`);
      if (!proceed) return;
    }
    const { body } = await request(`/api/workspaces/${state.workspace.id}/file?path=${encodeURIComponent(relativePath)}`);
    await initEditor();
    const monaco = await ensureMonaco();
    state.path = body.path;
    state.saveBaseline = body.content ?? '';
    const language = languageFromPath(body.path);
    const model = monaco.editor.createModel(state.saveBaseline, language);
    const prev = state.editor.getModel();
    state.editor.setModel(model);
    if (prev) prev.dispose();
    setDirty(false);
    updateEditorLabel();
    renderFiles();
    showPane('editor');
    requestAnimationFrame(() => {
      state.editor?.layout();
      state.editor?.focus();
    });
  }

  async function saveCurrentFile() {
    if (!state.path) throw new Error('Select a file first.');
    if (!state.workspace) throw new Error('No workspace open.');
    await initEditor();
    const content = getEditorValue();
    await request(`/api/workspaces/${state.workspace.id}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: state.path, content }),
    });
    state.saveBaseline = content;
    setDirty(false);
    flash(`Saved ${state.path}.`);
  }

  function showPane(name) {
    state.pane = name;
    document.querySelectorAll('.pane-switch button').forEach((button) => {
      const active = button.dataset.pane === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-pane-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panePanel === name);
    });
    if (name === 'files') $('aside').classList.add('open');
    if (name === 'editor' && state.editor) {
      requestAnimationFrame(() => state.editor.layout());
    }
    if (name === 'terminal') fitTerminalSoon();
  }

  /* BEGIN:XTERM_TERMINAL */
  function setTerminalStatus(label, stateName) {
    const el = $('#terminalStatus');
    if (!el) return;
    el.textContent = label;
    el.dataset.state = stateName || label;
  }

  function sendTerminalResize() {
    if (!state.term || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const cols = state.term.cols;
    const rows = state.term.rows;
    if (!cols || !rows) return;
    if (state.termLastSize.cols === cols && state.termLastSize.rows === rows) return;
    state.termLastSize = { cols, rows };
    // Control frame (JSON). Server applies via Docker /exec/{id}/resize; never written to PTY stdin.
    state.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  function fitTerminalSoon() {
    requestAnimationFrame(() => {
      try {
        if (state.fitAddon) state.fitAddon.fit();
        sendTerminalResize();
      } catch { /* host may be hidden */ }
    });
  }

  function ensureXterm() {
    if (state.term) return state.term;
    if (typeof Terminal === 'undefined') {
      throw new Error('xterm.js failed to load');
    }
    const FitCtor = (typeof FitAddon !== 'undefined' && (FitAddon.FitAddon || FitAddon)) || null;
    if (!FitCtor) throw new Error('xterm FitAddon failed to load');
    const host = $('#terminal');
    host.replaceChildren();
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#070a0c',
        foreground: '#7dffa5',
        cursor: '#7dffa5',
        selectionBackground: 'rgba(94, 234, 212, 0.28)'
      }
    });
    const fitAddon = new FitCtor();
    term.loadAddon(fitAddon);
    term.open(host);
    state.term = term;
    state.fitAddon = fitAddon;
    // Remote PTY echoes; do not local-echo.
    term.onData((data) => {
      if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
      state.socket.send(data);
    });
    const scheduleFit = () => fitTerminalSoon();
    window.addEventListener('resize', scheduleFit);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(scheduleFit);
      ro.observe(host);
      state.termResizeObserver = ro;
    }
    return term;
  }

  function clearTermReconnect() {
    if (state.termReconnectTimer) {
      clearTimeout(state.termReconnectTimer);
      state.termReconnectTimer = null;
    }
  }

  function disconnectTerminal({ manual = true } = {}) {
    state.termManualClose = manual;
    clearTermReconnect();
    if (state.socket) {
      try { state.socket.close(); } catch { /* already closed */ }
      state.socket = null;
    }
    state.termWorkspaceId = null;
    state.termReconnectAttempt = 0;
    state.termLastSize = { cols: 0, rows: 0 };
    setTerminalStatus('idle', 'idle');
  }

  function scheduleTerminalReconnect(workspaceId) {
    if (state.termManualClose) return;
    if (state.workspace?.id !== workspaceId || state.workspace?.status !== 'running') return;
    clearTermReconnect();
    state.termReconnectAttempt += 1;
    const delay = Math.min(8000, 600 * (2 ** Math.min(state.termReconnectAttempt - 1, 4)));
    setTerminalStatus(`reconnect ${Math.round(delay / 100) / 10}s`, 'reconnect');
    if (state.term) {
      state.term.writeln('');
      state.term.writeln(`[synapse] disconnected — reconnecting in ${Math.round(delay / 100) / 10}s…`);
    }
    state.termReconnectTimer = setTimeout(() => {
      state.termReconnectTimer = null;
      if (state.termManualClose) return;
      if (state.workspace?.id !== workspaceId || state.workspace?.status !== 'running') return;
      connectTerminal(workspaceId, { reconnect: true });
    }, delay);
  }

  function connectTerminal(workspaceId, { reconnect = false } = {}) {
    state.termManualClose = false;
    clearTermReconnect();
    if (state.socket) {
      try { state.socket.close(); } catch { /* ignore */ }
      state.socket = null;
    }
    state.termWorkspaceId = workspaceId;
    let term;
    try {
      term = ensureXterm();
    } catch (error) {
      setTerminalStatus('error', 'error');
      flash(error.message || 'Terminal failed to load.', true);
      return;
    }
    if (!reconnect) {
      term.reset();
      term.clear();
      state.termReconnectAttempt = 0;
      state.termLastSize = { cols: 0, rows: 0 };
    }
    fitTerminalSoon();
    setTerminalStatus('connecting', 'connecting');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/api/workspaces/${workspaceId}/terminal`);
    state.socket = socket;
    socket.addEventListener('open', () => {
      if (state.socket !== socket) return;
      state.termReconnectAttempt = 0;
      setTerminalStatus('live', 'live');
      fitTerminalSoon();
      // Force a resize frame even if FitAddon size matches last (new PTY).
      state.termLastSize = { cols: 0, rows: 0 };
      sendTerminalResize();
    });
    socket.addEventListener('message', (event) => {
      if (state.socket !== socket || !state.term) return;
      state.term.write(typeof event.data === 'string' ? event.data : String(event.data));
    });
    socket.addEventListener('error', () => {
      setTerminalStatus('error', 'error');
    });
    socket.addEventListener('close', () => {
      if (state.socket === socket) state.socket = null;
      if (state.termManualClose || state.termWorkspaceId !== workspaceId) {
        setTerminalStatus('closed', 'closed');
        return;
      }
      setTerminalStatus('closed', 'closed');
      scheduleTerminalReconnect(workspaceId);
    });
  }
  /* END:XTERM_TERMINAL */

  function bindPip() {
    const pip = $('#previewPip');
    const bar = $('#pipBar');
    let drag = null;
    bar.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || pip.classList.contains('expanded')) return;
      const rect = pip.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      bar.setPointerCapture(event.pointerId);
    });
    bar.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const stage = $('.workspace-stage').getBoundingClientRect();
      const x = Math.min(Math.max(event.clientX - drag.dx - stage.left, 8), stage.width - pip.offsetWidth - 8);
      const y = Math.min(Math.max(event.clientY - drag.dy - stage.top, 8), stage.height - pip.offsetHeight - 8);
      pip.style.left = `${x}px`;
      pip.style.top = `${y}px`;
      pip.style.right = 'auto';
      pip.style.bottom = 'auto';
    });
    bar.addEventListener('pointerup', () => { drag = null; });
    $('#pipMin').addEventListener('click', () => {
      pip.classList.toggle('minimized');
      pip.classList.remove('expanded');
    });
    $('#pipExpand').addEventListener('click', () => {
      pip.classList.toggle('expanded');
      pip.classList.remove('minimized');
    });
  }

  const guard = (fn) => async (event) => {
    try { await fn(event); } catch (error) { console.error(error); flash(error.message || 'Request failed.', true); }
  };

  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    setAuthError('');
    const password = $('#password').value;
    if (!password || password.length < 10) {
      setAuthError('Password must be at least 10 characters.');
      $('#password').focus();
      return;
    }
    const panel = $('#authPanel');
    const submit = $('#authSubmit');
    panel.classList.add('busy');
    submit.disabled = true;
    try {
      const session = await request('/api/auth/session');
      const path = session.body.owner ? '/api/auth/login' : '/api/auth/bootstrap';
      await request(path, { method: 'POST', body: JSON.stringify({ password }) });
      $('#password').value = '';
      flash('Owner session ready.');
      await loadSession();
    } catch (error) {
      console.error(error);
      const message = error.message || 'Sign-in failed.';
      setAuthError(message);
      flash(message, true);
      $('#password').focus();
      $('#password').select();
    } finally {
      panel.classList.remove('busy');
      submit.disabled = false;
    }
  });

  $('#password').addEventListener('input', () => setAuthError(''));

  $('#newWorkspace').addEventListener('click', () => {
    const dialog = $('#newWorkspaceDialog');
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    else createWorkspaceWithTemplate('static-site');
  });

  $('#newWorkspaceCancel')?.addEventListener('click', () => $('#newWorkspaceDialog')?.close());

  $('#newWorkspaceForm')?.addEventListener('submit', guard(async (event) => {
    event.preventDefault();
    const templateId = $('#newWorkspaceTemplate')?.value || 'static-site';
    $('#newWorkspaceDialog')?.close();
    await createWorkspaceWithTemplate(templateId);
  }));

  async function createWorkspaceWithTemplate(templateId) {
    const { body } = await request('/api/workspaces', { method: 'POST', body: JSON.stringify({ templateId }) });
    flash(`Workspace created (${templateId}).`);
    await loadWorkspaces(body.workspace.id);
  }

  $('#start').addEventListener('click', guard(async () => {
    await request(`/api/workspaces/${state.workspace.id}/start`, { method: 'POST', body: '{}' });
    flash('Runtime started.');
    await openWorkspace(state.workspace.id);
  }));

  $('#stop').addEventListener('click', guard(async () => {
    await request(`/api/workspaces/${state.workspace.id}/stop`, { method: 'POST', body: '{}' });
    flash('Runtime stopped.');
    await openWorkspace(state.workspace.id);
  }));

  $('#save').addEventListener('click', guard(async () => {
    await saveCurrentFile();
  }));

  $('#snapshot').addEventListener('click', guard(async () => {
    const branch = `snapshot-${Date.now()}`;
    await request(`/api/workspaces/${state.workspace.id}/snapshots`, { method: 'POST', body: JSON.stringify({ branch }) });
    flash(`Git snapshot ${branch} created.`);
  }));

  $('#exportWorkspace').addEventListener('click', guard(async () => {
    const response = await fetch(`/api/workspaces/${state.workspace.id}/export?format=tar`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Export failed.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'workspace.tar';
    link.click();
    URL.revokeObjectURL(url);
    flash('Workspace archive downloaded.');
  }));

  $('#chatForm').addEventListener('submit', guard(async (event) => {
    event.preventDefault();
    if (!state.workspace) throw new Error('Create a workspace first.');
    const prompt = $('#chatInput').value.trim();
    if (!prompt) return;
    const log = $('#chatLog');
    log.insertAdjacentHTML('beforeend', `<div class="msg user">${escapeHtml(prompt)}</div>`);
    $('#chatInput').value = '';
    $('#chatSend').disabled = true;
    try {
      const { body } = await request(`/api/workspaces/${state.workspace.id}/ai`, { method: 'POST', body: JSON.stringify({ prompt }) });
      const written = (body.written || []).join(', ');
      log.insertAdjacentHTML('beforeend', `<div class="msg assistant">${escapeHtml(body.reply || 'Done.')}${written ? `\nUpdated: ${escapeHtml(written)}` : ''}</div>`);
      log.scrollTop = log.scrollHeight;
      await openWorkspace(state.workspace.id);
      if (body.written && body.written[0]) await openFile(body.written[0]);
      flash(written ? `Grok updated ${written}.` : 'Grok replied.');
    } finally {
      $('#chatSend').disabled = false;
    }
  }));

  $('#chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (!chip) return;
    $('#chatInput').value = chip.dataset.chip;
    $('#chatInput').focus();
  });

  $('#logout').addEventListener('click', guard(async () => {
    await request('/api/auth/logout', { method: 'POST', body: '{}' });
    disconnectTerminal();
    flash('Signed out.');
    await loadSession();
  }));

  document.addEventListener('click', guard(async (event) => {
    const workspace = event.target.closest('[data-workspace]');
    const file = event.target.closest('[data-path]');
    const pane = event.target.closest('[data-pane]');
    if (event.target.closest('#menu')) $('aside').classList.toggle('open');
    if (workspace) await openWorkspace(workspace.dataset.workspace);
    if (file) await openFile(file.dataset.path);
    if (pane) showPane(pane.dataset.pane);
  }));

  /* terminal input: xterm onData + PTY resize (BEGIN:XTERM_TERMINAL) */

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    $('#installApp').hidden = false;
  });
  $('#installApp').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#installApp').hidden = true;
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  bindPip();
  showPane('chat');
  // Warm Monaco ASAP so Editor pane is ready after sign-in
  ensureMonaco().then(() => initEditor()).catch((error) => console.warn('Monaco preload:', error));
  loadSession().catch((error) => flash(error.message, true));
})();
