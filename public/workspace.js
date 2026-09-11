(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = { csrfToken: '', workspaces: [], workspace: null, files: [], path: '', socket: null, pane: 'chat', pip: { x: null, y: null } };
  const flash = (message, isError = false) => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.className = isError ? 'show error' : 'show';
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { toast.className = ''; }, 3300);
  };
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

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
    $('#crumb').textContent = authenticated ? 'workspace' : 'sign in';
    if (authenticated) {
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
    )).join('') || '<p class="eyebrow">No workspaces yet</p>';
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
    const { body } = await request(`/api/workspaces/${state.workspace.id}/file?path=${encodeURIComponent(relativePath)}`);
    state.path = body.path;
    $('#editor').value = body.content;
    $('#editorLabel').textContent = body.path;
    renderFiles();
    showPane('editor');
  }

  function showPane(name) {
    state.pane = name;
    document.querySelectorAll('.pane-switch button').forEach((button) => button.classList.toggle('active', button.dataset.pane === name));
    document.querySelectorAll('[data-pane-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.panePanel === name));
    if (name === 'files') $('aside').classList.add('open');
  }

  function disconnectTerminal() {
    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
  }

  function connectTerminal(workspaceId) {
    disconnectTerminal();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/api/workspaces/${workspaceId}/terminal`);
    state.socket = socket;
    const terminal = $('#terminal');
    terminal.textContent = '';
    socket.addEventListener('message', (event) => {
      terminal.textContent += event.data;
      terminal.scrollTop = terminal.scrollHeight;
    });
    socket.addEventListener('close', () => {
      if (state.socket === socket) state.socket = null;
    });
  }

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

  $('#authForm').addEventListener('submit', guard(async (event) => {
    event.preventDefault();
    const session = await request('/api/auth/session');
    const path = session.body.owner ? '/api/auth/login' : '/api/auth/bootstrap';
    await request(path, { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    $('#password').value = '';
    flash('Owner session ready.');
    await loadSession();
  }));

  $('#newWorkspace').addEventListener('click', guard(async () => {
    const { body } = await request('/api/workspaces', { method: 'POST', body: JSON.stringify({ templateId: 'static-site' }) });
    flash('Workspace created.');
    await loadWorkspaces(body.workspace.id);
  }));

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
    if (!state.path) throw new Error('Select a file first.');
    await request(`/api/workspaces/${state.workspace.id}/file`, { method: 'PUT', body: JSON.stringify({ path: state.path, content: $('#editor').value }) });
    flash(`Saved ${state.path}.`);
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

  $('#terminalInput').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !state.socket) return;
    state.socket.send(`${event.currentTarget.value}\n`);
    event.currentTarget.value = '';
  });

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
  loadSession().catch((error) => flash(error.message, true));
})();
