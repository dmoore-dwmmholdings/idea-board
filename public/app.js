// Idea Board — client. State in memory, render from state, persist through the local API.

const STAGES = [
  { id: 'spark', name: 'Spark', hint: 'Raw, unjudged' },
  { id: 'exploring', name: 'Exploring', hint: 'Worth a closer look' },
  { id: 'building', name: 'Building', hint: 'Being made' },
  { id: 'shipped', name: 'Shipped', hint: 'Out in the world' },
];

const ICONS = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z"/></svg>',
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

const state = {
  ideas: [],
  query: '',
  tag: null,
  view: 'board',
  openId: null,
  captureStage: 'spark',
};

const $ = (sel) => document.querySelector(sel);
const els = {
  board: $('#board'),
  archive: $('#archive'),
  filters: $('#filters'),
  heroEyebrow: $('#hero-eyebrow'),
  heroTitle: $('#hero-title'),
  heroMeta: $('#hero-meta'),
  archiveCount: $('#archive-count'),
  search: $('#search'),
  tagOptions: $('#tag-options'),
  toast: $('#toast'),
  capture: $('#capture'),
  captureForm: $('#capture-form'),
  captureTitle: $('#capture-title'),
  captureNotes: $('#capture-notes'),
  captureTags: $('#capture-tags'),
  captureStage: $('#capture-stage'),
  captureError: $('#capture-error'),
  captureSubmit: $('#capture-submit'),
  panel: $('#panel'),
  panelEyebrow: $('#panel-eyebrow'),
  panelTitle: $('#panel-title'),
  panelStage: $('#panel-stage'),
  panelTags: $('#panel-tags'),
  panelNotes: $('#panel-notes'),
  panelStar: $('#panel-star'),
  panelArchive: $('#panel-archive'),
  panelDelete: $('#panel-delete'),
  panelDates: $('#panel-dates'),
};

// ---------- helpers ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function parseTags(s) {
  return [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

function relTime(iso) {
  const secs = (Date.now() - new Date(iso)) / 1000;
  if (secs < 60) return 'now';
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h`;
  const days = hrs / 24;
  if (days < 7) return `${Math.floor(days)}d`;
  if (days < 365) return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function fullDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function byPriority(a, b) {
  if (a.starred !== b.starred) return a.starred ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function matches(idea) {
  if (state.tag && !idea.tags.includes(state.tag)) return false;
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return idea.title.toLowerCase().includes(q)
    || idea.notes.toLowerCase().includes(q)
    || idea.tags.some((t) => t.includes(q));
}

function inView(idea) {
  return state.view === 'archive' ? idea.stage === 'archived' : idea.stage !== 'archived';
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ---------- api ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

async function reload() {
  state.ideas = await api('GET', '/api/ideas');
  render();
}

async function patchIdea(id, fields) {
  const idea = state.ideas.find((i) => i.id === id);
  if (!idea) return;
  Object.assign(idea, fields, { updatedAt: new Date().toISOString() });
  render();
  try {
    Object.assign(idea, await api('PATCH', `/api/ideas/${id}`, fields));
    render();
  } catch (err) {
    toast(`Couldn't save: ${err.message}`);
    await reload().catch(() => {});
  }
}

// ---------- render ----------

function render() {
  renderHero();
  renderFilters();
  if (state.view === 'board') renderBoard();
  else renderArchive();
  els.board.hidden = state.view !== 'board';
  els.archive.hidden = state.view !== 'archive';
  els.archiveCount.textContent = state.ideas.filter((i) => i.stage === 'archived').length;
  document.querySelectorAll('.view-switch button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  });
  const allTags = [...new Set(state.ideas.flatMap((i) => i.tags))].sort();
  els.tagOptions.innerHTML = allTags.map((t) => `<option value="${esc(t)}">`).join('');
  if (state.openId) syncPanel();
}

function renderHero() {
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  if (state.view === 'archive') {
    els.heroEyebrow.textContent = 'Archive';
    els.heroTitle.innerHTML = 'Parked, not<br><em>forgotten.</em>';
    const n = state.ideas.filter((i) => i.stage === 'archived').length;
    els.heroMeta.innerHTML = n
      ? `<strong>${n} ${n === 1 ? 'idea' : 'ideas'}</strong> set aside. Open one to bring it back.`
      : 'Nothing archived yet.';
    return;
  }
  els.heroEyebrow.textContent = today;
  els.heroTitle.innerHTML = 'What should I<br><em>build next?</em>';
  const active = state.ideas.filter((i) => i.stage !== 'archived');
  if (!active.length) {
    els.heroMeta.innerHTML = `The board is empty. Press <kbd>${isMac ? '⌘K' : 'Ctrl K'}</kbd> to capture your first idea.`;
    return;
  }
  const weekAgo = Date.now() - 7 * 864e5;
  const fresh = active.filter((i) => new Date(i.createdAt) > weekAgo).length;
  const building = active.filter((i) => i.stage === 'building').length;
  const parts = [`<strong>${active.length} ${active.length === 1 ? 'idea' : 'ideas'}</strong> on the board.`];
  if (fresh) parts.push(`${fresh} new this week.`);
  if (building) parts.push(`${building} in Building.`);
  els.heroMeta.innerHTML = parts.join(' ');
}

function renderFilters() {
  const counts = new Map();
  state.ideas.filter(inView).forEach((i) => i.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  if (state.tag && !counts.has(state.tag)) state.tag = null;
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!tags.length) {
    els.filters.innerHTML = '';
    return;
  }
  els.filters.innerHTML = tags.map(([t, n]) => `
    <button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">
      ${esc(t)} <span class="count">${n}</span>
    </button>`).join('')
    + (state.tag ? '<button type="button" class="clear" data-clear-tag>Clear filter</button>' : '');
}

function cardHtml(idea) {
  const tags = idea.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `
    <article class="card${idea.starred ? ' starred' : ''}" draggable="true" data-id="${idea.id}">
      <div class="card-top">
        <button type="button" class="card-open" data-open="${idea.id}">${esc(idea.title)}</button>
        <button type="button" class="star" data-star="${idea.id}" aria-pressed="${idea.starred}" aria-label="${idea.starred ? 'Unstar' : 'Star'} ${esc(idea.title)}">${ICONS.star}</button>
      </div>
      ${idea.notes.trim() ? `<p class="card-notes">${esc(idea.notes)}</p>` : ''}
      <div class="card-foot">${tags}<span class="card-time" title="Updated ${esc(fullDate(idea.updatedAt))}">${relTime(idea.updatedAt)}</span></div>
    </article>`;
}

function renderBoard() {
  const visible = state.ideas.filter((i) => i.stage !== 'archived' && matches(i));
  const filtering = state.query || state.tag;
  els.board.innerHTML = STAGES.map((stage) => {
    const ideas = visible.filter((i) => i.stage === stage.id).sort(byPriority);
    const body = ideas.length
      ? ideas.map(cardHtml).join('')
      : filtering
        ? ''
        : `<button type="button" class="empty-slot" data-add="${stage.id}">Nothing in ${stage.name} yet</button>`;
    return `
      <section class="column" data-stage="${stage.id}" style="--stage: var(--${stage.id})" aria-labelledby="col-${stage.id}">
        <div class="column-head">
          <span class="dot" aria-hidden="true"></span>
          <h2 id="col-${stage.id}">${stage.name}</h2>
          <span class="count">${ideas.length}</span>
          <button type="button" class="icon-btn" data-add="${stage.id}" aria-label="Add idea to ${stage.name}">${ICONS.plus}</button>
        </div>
        <p class="column-hint">${stage.hint}</p>
        <div class="cards">${body}</div>
      </section>`;
  }).join('');
  if (filtering && !visible.length) {
    els.board.insertAdjacentHTML('beforeend', '<p class="no-results">No ideas match that search.</p>');
  }
}

function renderArchive() {
  const ideas = state.ideas.filter((i) => i.stage === 'archived' && matches(i)).sort(byPriority);
  if (!ideas.length) {
    els.archive.innerHTML = `<p class="archive-empty">${state.query || state.tag ? 'No archived ideas match.' : 'Archived ideas show up here.'}</p>`;
    return;
  }
  els.archive.innerHTML = `<ul class="archive-list">${ideas.map((i) => `
    <li>
      <button type="button" class="card-open" data-open="${i.id}">${esc(i.title)}</button>
      <span class="tags">${i.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>
      <span class="card-time">${relTime(i.updatedAt)}</span>
    </li>`).join('')}</ul>`;
}

function renderStagePicker(fieldset, current, onPick) {
  fieldset.querySelector('.options')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'options';
  wrap.innerHTML = STAGES.map((s) => `
    <button type="button" data-stage="${s.id}" aria-pressed="${s.id === current}" style="--stage: var(--${s.id})">
      <span class="dot" aria-hidden="true"></span>${s.name}
    </button>`).join('');
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-stage]');
    if (btn) onPick(btn.dataset.stage);
  });
  fieldset.appendChild(wrap);
}

// ---------- capture ----------

function openCapture(stage = 'spark') {
  if (els.capture.open) return;
  if (els.panel.open) els.panel.close();
  state.captureStage = stage;
  els.captureForm.reset();
  els.captureError.textContent = '';
  if (state.tag) els.captureTags.value = state.tag;
  renderStagePicker(els.captureStage, stage, pickCaptureStage);
  els.capture.showModal();
  els.captureTitle.focus();
}

function pickCaptureStage(stage) {
  state.captureStage = stage;
  els.captureStage.querySelectorAll('button[data-stage]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.stage === stage));
  });
}

async function submitCapture() {
  const title = els.captureTitle.value.trim();
  if (!title) {
    els.captureError.textContent = 'Give the idea a title first.';
    els.captureTitle.focus();
    return;
  }
  els.captureSubmit.disabled = true;
  try {
    const idea = await api('POST', '/api/ideas', {
      title,
      notes: els.captureNotes.value,
      stage: state.captureStage,
      tags: parseTags(els.captureTags.value),
    });
    state.ideas.push(idea);
    if (state.view !== 'board') state.view = 'board';
    els.capture.close();
    render();
    toast(`Added to ${STAGES.find((s) => s.id === idea.stage).name}`);
  } catch (err) {
    els.captureError.textContent = err.message;
  } finally {
    els.captureSubmit.disabled = false;
  }
}

els.captureForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitCapture();
});

els.captureNotes.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitCapture();
  }
});

els.captureTags.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitCapture();
  }
});

// ---------- detail panel ----------

function currentIdea() {
  return state.ideas.find((i) => i.id === state.openId);
}

function openPanel(id) {
  state.openId = id;
  const idea = currentIdea();
  if (!idea) return;
  els.panelTitle.value = idea.title;
  els.panelNotes.value = idea.notes;
  els.panelTags.value = idea.tags.join(', ');
  syncPanel();
  if (!els.panel.open) els.panel.showModal();
  els.panelTitle.blur();
  els.panel.querySelector('[data-close]').focus();
}

// Refresh the parts of the panel that change without typing.
function syncPanel() {
  const idea = currentIdea();
  if (!idea) {
    if (els.panel.open) els.panel.close();
    return;
  }
  const stage = STAGES.find((s) => s.id === idea.stage);
  els.panelEyebrow.textContent = stage ? stage.name : 'Archived';
  renderStagePicker(els.panelStage, idea.stage, (s) => patchIdea(idea.id, { stage: s }));
  els.panelStar.setAttribute('aria-pressed', String(idea.starred));
  els.panelStar.setAttribute('aria-label', idea.starred ? 'Unstar' : 'Star');
  els.panelArchive.textContent = idea.stage === 'archived' ? 'Restore to Spark' : 'Archive';
  els.panelDates.innerHTML = `Created ${esc(fullDate(idea.createdAt))}<br>Updated ${esc(fullDate(idea.updatedAt))}`;
}

function flushPanel() {
  const idea = currentIdea();
  if (!idea) return;
  const fields = {};
  const title = els.panelTitle.value.trim();
  if (!title) els.panelTitle.value = idea.title;
  else if (title !== idea.title) fields.title = title;
  if (els.panelNotes.value !== idea.notes) fields.notes = els.panelNotes.value;
  const tags = parseTags(els.panelTags.value);
  if (tags.join(',') !== idea.tags.join(',')) fields.tags = tags;
  if (Object.keys(fields).length) patchIdea(idea.id, fields);
}

els.panelTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.panelTitle.blur();
  }
});
els.panelTags.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.panelTags.blur();
  }
});
[els.panelTitle, els.panelNotes, els.panelTags].forEach((el) => el.addEventListener('blur', flushPanel));

els.panelStar.addEventListener('click', () => {
  const idea = currentIdea();
  if (idea) patchIdea(idea.id, { starred: !idea.starred });
});

els.panelArchive.addEventListener('click', () => {
  const idea = currentIdea();
  if (!idea) return;
  const archiving = idea.stage !== 'archived';
  patchIdea(idea.id, { stage: archiving ? 'archived' : 'spark' });
  els.panel.close();
  toast(archiving ? 'Archived' : 'Restored to Spark');
});

els.panelDelete.addEventListener('click', async () => {
  const idea = currentIdea();
  if (!idea || !confirm(`Delete "${idea.title}"? This can't be undone.`)) return;
  try {
    await api('DELETE', `/api/ideas/${idea.id}`);
    state.ideas = state.ideas.filter((i) => i.id !== idea.id);
    state.openId = null;
    els.panel.close();
    render();
    toast('Deleted');
  } catch (err) {
    toast(`Couldn't delete: ${err.message}`);
  }
});

els.panel.addEventListener('close', () => {
  flushPanel();
  state.openId = null;
});

// Shared dialog behavior: close buttons and backdrop clicks.
[els.capture, els.panel].forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
});

// ---------- board events ----------

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-open], [data-star], [data-add], [data-tag], [data-clear-tag], [data-view]');
  if (!t || t.closest('dialog')) return;
  if (t.dataset.open) openPanel(t.dataset.open);
  else if (t.dataset.star) {
    const idea = state.ideas.find((i) => i.id === t.dataset.star);
    patchIdea(idea.id, { starred: !idea.starred });
  } else if (t.dataset.add) openCapture(t.dataset.add);
  else if (t.dataset.tag) {
    state.tag = state.tag === t.dataset.tag ? null : t.dataset.tag;
    render();
  } else if ('clearTag' in t.dataset) {
    state.tag = null;
    render();
  } else if (t.dataset.view) {
    state.view = t.dataset.view;
    render();
  }
});

$('#new-idea').addEventListener('click', () => openCapture());

els.search.addEventListener('input', () => {
  state.query = els.search.value.trim();
  render();
});
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.search.value = '';
    state.query = '';
    render();
    els.search.blur();
  }
});

// Drag and drop between columns.
let dragId = null;

els.board.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  dragId = card.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => card.classList.add('dragging'));
});

els.board.addEventListener('dragend', () => {
  dragId = null;
  els.board.querySelectorAll('.dragging, .drag-over').forEach((el) => el.classList.remove('dragging', 'drag-over'));
});

els.board.addEventListener('dragover', (e) => {
  const column = e.target.closest('.column');
  if (!column || !dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  els.board.querySelectorAll('.drag-over').forEach((el) => el !== column && el.classList.remove('drag-over'));
  column.classList.add('drag-over');
});

els.board.addEventListener('dragleave', (e) => {
  const column = e.target.closest('.column');
  if (column && !column.contains(e.relatedTarget)) column.classList.remove('drag-over');
});

els.board.addEventListener('drop', (e) => {
  const column = e.target.closest('.column');
  if (!column || !dragId) return;
  e.preventDefault();
  const idea = state.ideas.find((i) => i.id === dragId);
  if (idea && idea.stage !== column.dataset.stage) patchIdea(idea.id, { stage: column.dataset.stage });
  column.classList.remove('drag-over');
});

// ---------- keyboard ----------

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  const dialogOpen = els.capture.open || els.panel.open;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCapture();
    return;
  }
  if (dialogOpen || isTyping(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n') {
    e.preventDefault();
    openCapture();
  } else if (e.key === '/') {
    e.preventDefault();
    els.search.focus();
  }
});

// ---------- boot ----------

$('#new-shortcut').textContent = isMac ? '⌘K' : 'Ctrl K';
$('#save-shortcut').textContent = isMac ? '⌘↵' : 'Ctrl ↵';

// Keep relative times fresh.
setInterval(() => state.view === 'board' && !document.hidden && !dragId && renderBoard(), 60_000);

reload().catch((err) => {
  els.board.innerHTML = `<p class="no-results">Couldn't reach the Idea Board server. Is <code>npm start</code> running?<br>${esc(err.message)}</p>`;
});
