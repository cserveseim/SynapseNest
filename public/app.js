(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = {
    projects: [],
    project: null,
    selected: null,
    compare: null,
    templates: []
  };
  const el = {
    projects: $('#projects'),
    empty: $('#empty'),
    studio: $('#studio'),
    crumb: $('#crumb'),
    title: $('#title'),
    description: $('#description'),
    template: $('#template'),
    count: $('#count'),
    updated: $('#updated'),
    lineage: $('#lineage'),
    picker: $('#picker'),
    previews: $('#previews'),
    fork: $('#fork'),
    winner: $('#winnerLabel'),
    copy: $('#publishCopy'),
    publish: $('#publish'),
    export: $('#export'),
    toast: $('#toast'),
    templateSelect: $('#templateSelect'),
    recipeHint: $('#recipeHint')
  };

  const esc = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const idOf = (item) => item && item.id;
  const nameOf = (item, fallback = 'Untitled synapse') => (item && (item.name || item.title)) || fallback;
  const noteOf = (item) => (item && item.note) || 'A new direction waiting for an annotation.';
  const synapses = () => state.project?.synapses || [];
  const winnerId = () => state.project?.winnerSynapseId || state.project?.winnerId || state.project?.winner?.id;
  const flash = (message, isError = false) => {
    el.toast.textContent = message;
    el.toast.className = isError ? 'show error' : 'show';
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { el.toast.className = ''; }, 3300);
  };
  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(body.error || `Request failed (${response.status})`);
    }
    return response;
  };
  const json = async (path, options) => (await request(path, options)).json();
  const date = (value) => value
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
    : 'Just now';

  async function loadTemplates() {
    try {
      const payload = await json('/api/templates');
      state.templates = payload.templates || [];
      if (el.templateSelect) {
        el.templateSelect.innerHTML = state.templates.map((template) => (
          `<option value="${esc(template.id)}" data-runtime="${esc(template.runtime)}">${esc(template.title)}</option>`
        )).join('') || '<option value="static-site">Static site</option>';
        updateRecipeHint();
      }
    } catch (error) {
      console.error(error);
      if (el.templateSelect && !el.templateSelect.options.length) {
        el.templateSelect.innerHTML = '<option value="static-site">Static site</option>';
      }
    }
  }

  function updateRecipeHint() {
    if (!el.recipeHint || !el.templateSelect) return;
    const selected = state.templates.find((template) => template.id === el.templateSelect.value);
    if (!selected) {
      el.recipeHint.textContent = 'Recipes load from templates/*/synapsenest.yaml';
      return;
    }
    el.recipeHint.textContent = `${selected.runtime} · ${selected.install || 'none'} · ${selected.command || 'httpd'} — ${selected.description || 'Reviewed starter recipe'}`;
  }

  async function projects(pick) {
    const payload = await json('/api/projects');
    state.projects = payload.projects || [];
    list();
    const nextId = pick || state.project?.id || state.projects[0]?.id;
    if (nextId) await project(nextId);
    else render();
  }

  async function project(projectId) {
    state.project = (await json(`/api/projects/${encodeURIComponent(projectId)}`)).project;
    const all = synapses();
    if (!all.some((item) => idOf(item) === state.selected)) state.selected = idOf(all[0]);
    if (!all.some((item) => idOf(item) === state.compare) || state.compare === state.selected) {
      state.compare = idOf(all.find((item) => idOf(item) !== state.selected) || all[0]);
    }
    list();
    render();
  }

  function list() {
    el.projects.innerHTML = state.projects.map((projectItem) => (
      `<button class="project ${projectItem.id === state.project?.id ? 'active' : ''}" data-project="${esc(projectItem.id)}">
        <b>${esc(nameOf(projectItem, 'Untitled genome'))}</b>
        <span>${esc(projectItem.template || `${projectItem.synapseCount || 0} synapses`)}</span>
      </button>`
    )).join('');
  }

  function parentName(synapse) {
    if (!synapse || !synapse.parentId) return '— root';
    const parent = synapses().find((item) => idOf(item) === synapse.parentId);
    return parent ? nameOf(parent) : synapse.parentId;
  }

  function fieldRows(left, right) {
    const environment = state.project?.environment || {};
    const rows = [
      ['Name', nameOf(left), nameOf(right)],
      ['Status', left?.status || '—', right?.status || '—'],
      ['Note', noteOf(left), noteOf(right)],
      ['Parent', parentName(left), parentName(right)],
      ['Theme', left?.previewTheme || '—', right?.previewTheme || '—'],
      ['Created', date(left?.createdAt), date(right?.createdAt)],
      ['Synapse ID', left?.id || '—', right?.id || '—'],
      ['Environment', `${environment.runtime || '—'} / ${environment.command || '—'}`, `${environment.runtime || '—'} / ${environment.command || '—'}`],
      ['Recipe template', environment.template || state.project?.template || '—', environment.template || state.project?.template || '—']
    ];
    return rows.map(([label, a, b]) => {
      const differs = String(a) !== String(b);
      return `<tr class="${differs ? 'diff' : 'same'}">
        <th scope="row">${esc(label)}</th>
        <td>${esc(a)}</td>
        <td>${esc(b)}</td>
      </tr>`;
    }).join('');
  }

  function renderCompare(selected, comparison) {
    const all = [selected, comparison].filter(Boolean);
    if (!all.length) {
      el.previews.innerHTML = '<p class="pill">No synapses to compare yet.</p>';
      return;
    }

    if (all.length === 1) {
      const synapse = all[0];
      const win = idOf(synapse) === winnerId();
      el.previews.innerHTML = `
        <article class="preview compare-card ${win ? 'iswinner' : ''}">
          <div class="previewHead">
            <span>SELECTED SYNAPSE</span>
            <b>${esc(nameOf(synapse))}</b>
          </div>
          <div class="compare-body">
            <dl class="synapse-facts">
              <div><dt>Status</dt><dd>${esc(synapse.status || '—')}</dd></div>
              <div><dt>Parent</dt><dd>${esc(parentName(synapse))}</dd></div>
              <div><dt>Theme</dt><dd>${esc(synapse.previewTheme || '—')}</dd></div>
              <div><dt>Created</dt><dd>${esc(date(synapse.createdAt))}</dd></div>
              <div class="wide"><dt>Note</dt><dd>${esc(noteOf(synapse))}</dd></div>
              <div class="wide"><dt>Synapse ID</dt><dd><code>${esc(synapse.id || '')}</code></dd></div>
            </dl>
            <p class="compare-hint">Fork this synapse to unlock a living side-by-side compare against real lineage data.</p>
          </div>
          <div class="previewFoot">
            <span>${win ? 'Current winner' : esc(noteOf(synapse).slice(0, 64))}</span>
            <button class="winner" data-winner="${esc(idOf(synapse))}" ${win ? 'disabled' : ''}>${win ? 'Winner ✓' : 'Choose winner'}</button>
          </div>
        </article>`;
      return;
    }

    const left = all[0];
    const right = all[1];
    const leftWin = idOf(left) === winnerId();
    const rightWin = idOf(right) === winnerId();
    el.previews.innerHTML = `
      <div class="compare-grid">
        <article class="preview compare-card ${leftWin ? 'iswinner' : ''}">
          <div class="previewHead"><span>SELECTED</span><b>${esc(nameOf(left))}</b></div>
          <div class="compare-body">
            <p class="note-block">${esc(noteOf(left))}</p>
            <ul class="meta-list">
              <li><span>Status</span><strong>${esc(left.status || '—')}</strong></li>
              <li><span>Parent</span><strong>${esc(parentName(left))}</strong></li>
              <li><span>Theme</span><strong>${esc(left.previewTheme || '—')}</strong></li>
              <li><span>Created</span><strong>${esc(date(left.createdAt))}</strong></li>
            </ul>
            <code class="id-line">${esc(left.id || '')}</code>
          </div>
          <div class="previewFoot">
            <span>${leftWin ? 'Current winner' : 'Candidate'}</span>
            <button class="winner" data-winner="${esc(idOf(left))}" ${leftWin ? 'disabled' : ''}>${leftWin ? 'Winner ✓' : 'Choose winner'}</button>
          </div>
        </article>
        <article class="preview compare-card ${rightWin ? 'iswinner' : ''}">
          <div class="previewHead"><span>COMPARISON</span><b>${esc(nameOf(right))}</b></div>
          <div class="compare-body">
            <p class="note-block">${esc(noteOf(right))}</p>
            <ul class="meta-list">
              <li><span>Status</span><strong>${esc(right.status || '—')}</strong></li>
              <li><span>Parent</span><strong>${esc(parentName(right))}</strong></li>
              <li><span>Theme</span><strong>${esc(right.previewTheme || '—')}</strong></li>
              <li><span>Created</span><strong>${esc(date(right.createdAt))}</strong></li>
            </ul>
            <code class="id-line">${esc(right.id || '')}</code>
          </div>
          <div class="previewFoot">
            <span>${rightWin ? 'Current winner' : 'Candidate'}</span>
            <button class="winner" data-winner="${esc(idOf(right))}" ${rightWin ? 'disabled' : ''}>${rightWin ? 'Winner ✓' : 'Choose winner'}</button>
          </div>
        </article>
      </div>
      <section class="diff-panel" aria-label="Synapse field compare">
        <div class="diff-head">
          <p class="eyebrow">Living compare</p>
          <h3>Field-by-field from project genome</h3>
          <small>Source: <code>GET /api/projects/${esc(state.project.id)}</code> — not mock tiles</small>
        </div>
        <table class="diff-table">
          <thead>
            <tr><th>Field</th><th>${esc(nameOf(left))}</th><th>${esc(nameOf(right))}</th></tr>
          </thead>
          <tbody>${fieldRows(left, right)}</tbody>
        </table>
      </section>`;
  }

  function render() {
    const projectItem = state.project;
    const all = synapses();
    el.empty.hidden = !!projectItem;
    el.studio.hidden = !projectItem;
    el.export.disabled = !projectItem;
    if (!projectItem) return;

    el.crumb.textContent = el.title.textContent = nameOf(projectItem, 'Untitled genome');
    el.description.textContent = projectItem.description || 'A project genome with room to evolve.';
    el.template.textContent = projectItem.template || 'PROJECT GENOME';
    el.count.textContent = `${all.length} synapse${all.length === 1 ? '' : 's'}`;
    el.updated.textContent = `Updated ${date(projectItem.updatedAt || projectItem.createdAt)}`;

    const winner = winnerId();
    const active = all.find((item) => idOf(item) === state.selected) || all[0];
    el.fork.disabled = !active;
    el.publish.disabled = !winner;
    el.winner.textContent = winner
      ? `${nameOf(all.find((item) => idOf(item) === winner))} is the current winner`
      : 'Choose a synapse to publish';
    el.copy.textContent = winner
      ? 'Publish creates a local proof event without leaving your workspace.'
      : 'Compare your branches, then mark the expression you want to carry forward.';

    el.lineage.innerHTML = all.map((item, index) => (
      `<button class="synapse ${idOf(item) === state.selected ? 'selected' : ''}" data-synapse="${esc(idOf(item))}">
        <span class="branch">${index ? 'BRANCH' : 'ROOT'} / ${String(index).padStart(2, '0')}</span>
        ${idOf(item) === winner ? '<i class="badge">WINNER</i>' : ''}
        <strong>${esc(nameOf(item))}</strong>
        <p>${esc(noteOf(item))}</p>
      </button>`
    )).join('');

    el.picker.innerHTML = all.length > 1
      ? `<select id="compare" aria-label="Compare synapse">
          <option disabled>Compare with…</option>
          ${all.filter((item) => idOf(item) !== state.selected).map((item) => (
            `<option value="${esc(idOf(item))}" ${idOf(item) === state.compare ? 'selected' : ''}>Compare with ${esc(nameOf(item))}</option>`
          )).join('')}
        </select>`
      : '<span class="pill">Fork a synapse to compare</span>';

    renderCompare(active, all.find((item) => idOf(item) === state.compare));
  }

  const safe = (fn) => async (event) => {
    try { await fn(event); }
    catch (error) {
      console.error(error);
      flash(error.message || 'Something went sideways.', true);
    }
  };

  document.addEventListener('click', safe(async (event) => {
    const projectButton = event.target.closest('[data-project]');
    const synapseButton = event.target.closest('[data-synapse]');
    const winnerButton = event.target.closest('[data-winner]');
    if (projectButton) return project(projectButton.dataset.project);
    if (synapseButton) {
      state.selected = synapseButton.dataset.synapse;
      if (state.compare === state.selected) {
        state.compare = idOf(synapses().find((item) => idOf(item) !== state.selected));
      }
      return render();
    }
    if (winnerButton) {
      await json(`/api/projects/${state.project.id}/winner`, {
        method: 'POST',
        body: JSON.stringify({ synapseId: winnerButton.dataset.winner })
      });
      flash('Winner selected. This branch now leads the genome.');
      return project(state.project.id);
    }
    if (event.target.closest('[data-create]') || event.target.closest('#newProject')) {
      await loadTemplates();
      $('#createDialog').showModal();
    }
    if (event.target.closest('#fork')) $('#forkDialog').showModal();
    if (event.target.closest('#publish')) {
      await json(`/api/projects/${state.project.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ synapseId: winnerId() })
      });
      flash('Published locally — proof event recorded.');
      return project(state.project.id);
    }
    if (event.target.closest('#export')) {
      const response = await request(`/api/projects/${state.project.id}/export`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${nameOf(state.project, 'project-genome')}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      flash('Portable genome export downloaded.');
    }
    if (event.target.closest('#menu')) $('aside').classList.toggle('open');
    if (event.target.closest('dialog .close') || (event.target.matches && event.target.matches('dialog button.quiet[value=cancel]'))) {
      const dialog = event.target.closest('dialog');
      if (dialog) dialog.close();
    }
  }));

  document.addEventListener('change', (event) => {
    if (event.target.id === 'compare') {
      state.compare = event.target.value;
      render();
    }
    if (event.target.id === 'templateSelect') updateRecipeHint();
  });

  $('#createForm').addEventListener('submit', safe(async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const templateId = String(form.get('template') || 'static-site');
    const catalogEntry = state.templates.find((template) => template.id === templateId);
    const payload = await json('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        title: String(form.get('name') || '').trim(),
        description: String(form.get('description') || '').trim(),
        template: catalogEntry?.genomeTemplate || catalogEntry?.title || templateId
      })
    });
    event.currentTarget.reset();
    $('#createDialog').close();
    flash(`Genome created${catalogEntry ? ` from ${catalogEntry.title}` : ''}.`);
    projects(payload.project.id);
  }));

  $('#forkForm').addEventListener('submit', safe(async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await json(`/api/projects/${state.project.id}/synapses`, {
      method: 'POST',
      body: JSON.stringify({
        parentId: state.selected,
        name: String(form.get('name') || '').trim(),
        note: String(form.get('note') || '').trim()
      })
    });
    event.currentTarget.reset();
    $('#forkDialog').close();
    flash('Fork created.');
    project(state.project.id);
  }));

  Promise.all([loadTemplates(), projects()]).catch((error) => flash(`Could not load genomes: ${error.message}`, true));
})();
