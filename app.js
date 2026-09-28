// Build flat list with genre overrides
const ALL = [];
Object.entries(RAW).forEach(([cat, titles]) => {
  titles.forEach(title => {
    const ym = title.match(/\((\d{4})\)/);
    const year = ym ? +ym[1] : null;
    const decade = year ? Math.floor(year/10)*10 : null;
    const clean = title.replace(/\s*\(\d{4}\)\s*/,'').trim();
    const lc = title.toLowerCase();
    const tags = (METADATA[title]?.genres?.length)
      ? [...METADATA[title].genres]
      : GENRE_OVERRIDES[title]
        ? [...GENRE_OVERRIDES[title]]
        : Object.entries(GENRE_KW).filter(([,kws]) => kws.some(k => lc.includes(k))).map(([g]) => g);
    ALL.push({ title, clean, cat, year, decade, tags });
  });
});

// Show AI features only when running locally
const AI_ENABLED = location.hostname === 'localhost' ||
                   location.hostname === '127.0.0.1' ||
                   location.protocol === 'file:';

// ============================================================
// STATE
// ============================================================
let activeMoods = [], activeTypes = new Set(), activeGenres = new Set();
let aiConv = [], aiLoading = false, aiAvailable = null, surpriseItem = null;
let viewMode = 'grid'; // 'grid' | 'list'
let sortMode = 'default';
let statusFilter = 'all'; // 'all' | 'unwatched' | 'want' | 'watched'
let STATUS = {}, META = {};
let WIZ_WATCHED = {}; // {vaultTitle → wiz film obj} — in-memory only, not persisted

function effectiveStatus(title) {
  return STATUS[title] || (WIZ_WATCHED[title] ? 'watched' : null);
}

// ============================================================
// PERSISTENCE
// ============================================================
function loadPersisted() {
  try { STATUS = JSON.parse(localStorage.getItem('vault_status') || '{}'); } catch(e) { STATUS = {}; }
  try { META = JSON.parse(localStorage.getItem('vault_meta') || '{}'); } catch(e) { META = {}; }
  try {
    const saved = JSON.parse(localStorage.getItem('vault_ai_conv') || '[]');
    aiConv = Array.isArray(saved) ? saved : [];
  } catch(e) { aiConv = []; }
  updateStatBar();
}

function saveStatus() {
  localStorage.setItem('vault_status', JSON.stringify(STATUS));
  updateStatBar();
}

function saveMeta() { localStorage.setItem('vault_meta', JSON.stringify(META)); }

function saveAIConv() {
  localStorage.setItem('vault_ai_conv', JSON.stringify(aiConv.slice(-40)));
}

function getWatchlistCount() { return Object.values(STATUS).filter(v => v === 'want').length; }
function getWatchedCount() {
  return Object.values(STATUS).filter(v => v === 'watched').length +
         Object.keys(WIZ_WATCHED).filter(t => !STATUS[t]).length;
}

function updateStatBar() {
  const wl = getWatchlistCount(), wd = getWatchedCount();
  const wlStat = document.getElementById('statWatchlist');
  const wdStat = document.getElementById('statWatched');
  if (wlStat) { wlStat.style.display = wl ? '' : 'none'; document.getElementById('wlCount').textContent = wl; }
  if (wdStat) { wdStat.style.display = wd ? '' : 'none'; document.getElementById('wdCount').textContent = wd; }
}

// ============================================================
// AI STATUS
// ============================================================
async function checkAI() {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:5, messages:[{role:'user',content:'hi'}] })
    });
    const d = await r.json();
    aiAvailable = !d.error;
  } catch(e) { aiAvailable = false; }
  updateAIStatus();
}

function updateAIStatus() {
  const dot = document.getElementById('aiDot');
  const txt = document.getElementById('aiStatusText');
  const banner = document.getElementById('offlineBanner');
  const input = document.getElementById('aiInput');
  const sendBtn = document.getElementById('sendBtn');
  const aiPrompts = document.getElementById('aiQuickPrompts');
  const offlineActions = document.getElementById('offlineQuickActions');

  if (aiAvailable) {
    dot.className = 'ai-dot';
    txt.textContent = 'AI ONLINE';
    banner.style.display = 'none';
    input.disabled = false;
    input.placeholder = 'Describe your mood, a genre, something you loved, or ask anything…';
    sendBtn.disabled = aiLoading;
    if (aiPrompts) aiPrompts.style.display = '';
    if (offlineActions) offlineActions.style.display = 'none';
  } else {
    dot.className = 'ai-dot offline';
    txt.textContent = 'AI OFFLINE';
    banner.style.display = 'flex';
    input.disabled = true;
    input.placeholder = 'AI unavailable — use Browse & Search';
    sendBtn.disabled = true;
    const tab = document.getElementById('tabBrowse');
    if (!tab.querySelector('.tab-badge')) {
      const b = document.createElement('span'); b.className = 'tab-badge'; b.textContent = 'USE THIS'; tab.appendChild(b);
    }
    if (aiPrompts) aiPrompts.style.display = 'none';
    if (offlineActions) offlineActions.style.display = '';
    switchTab('browse');
  }
}

// ============================================================
// TABS
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const sidebar = document.querySelector('.sidebar');
  if (tab === 'ai') {
    document.getElementById('tabAI').classList.add('active');
    document.getElementById('panelAI').classList.add('active');
    document.getElementById('aiQuickModes').style.display = '';
    sidebar.style.display = '';
  } else if (tab === 'fall') {
    document.getElementById('tabFall').classList.add('active');
    document.getElementById('panelFall').classList.add('active');
    sidebar.style.display = 'none';
    renderFall();
  } else {
    document.getElementById('tabBrowse').classList.add('active');
    document.getElementById('panelBrowse').classList.add('active');
    document.getElementById('aiQuickModes').style.display = 'none';
    sidebar.style.display = '';
    runSearch();
  }
}

// ============================================================
// SIDEBAR
// ============================================================
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}

function toggleMood(el, mood) {
  el.classList.toggle('active');
  if (el.classList.contains('active')) activeMoods.push(mood);
  else activeMoods = activeMoods.filter(m => m !== mood);
  if (window.innerWidth <= 700) document.querySelector('.sidebar').classList.remove('open');
  if (document.getElementById('panelBrowse').classList.contains('active')) runSearch();
}

function toggleType(el, type) {
  el.classList.toggle('active');
  if (el.classList.contains('active')) activeTypes.add(type);
  else activeTypes.delete(type);
  if (window.innerWidth <= 700) document.querySelector('.sidebar').classList.remove('open');
  if (document.getElementById('panelBrowse').classList.contains('active')) runSearch();
}

function toggleGenre(el, g) {
  el.classList.toggle('active');
  if (el.classList.contains('active')) activeGenres.add(g); else activeGenres.delete(g);
  runSearch();
}

function clearAllFilters() {
  activeGenres.clear(); activeTypes.clear(); activeMoods = []; surpriseItem = null;
  document.querySelectorAll('.filter-btn,.type-pill,.chip').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sfAll').classList.add('active');
  statusFilter = 'all';
  document.getElementById('searchInput').value = '';
  document.getElementById('decadeFilter').value = '';
  runSearch();
}

// ============================================================
// BROWSE CONTROLS
// ============================================================
function offlineBrowse(opts = {}) {
  if (opts.genre) {
    activeGenres.add(opts.genre);
    document.querySelector(`.filter-btn[onclick*="'${opts.genre}'"]`)?.classList.add('active');
  }
  if (opts.decade) document.getElementById('decadeFilter').value = opts.decade;
  if (opts.status) {
    statusFilter = opts.status;
    document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    const map = { all:'sfAll', unwatched:'sfUnwatched', want:'sfWant', watched:'sfWatched' };
    document.getElementById(map[opts.status])?.classList.add('active');
  }
  switchTab('browse');
  if (opts.surprise) surpriseMe();
}
function setStatusFilter(filter) {
  statusFilter = filter;
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  const map = { all:'sfAll', unwatched:'sfUnwatched', want:'sfWant', watched:'sfWatched' };
  const btn = document.getElementById(map[filter]);
  if (btn) btn.classList.add('active');
  surpriseItem = null;
  runSearch();
}

function toggleView() {
  viewMode = viewMode === 'grid' ? 'list' : 'grid';
  const btn = document.getElementById('viewToggleBtn');
  const grid = document.getElementById('resultsGrid');
  if (viewMode === 'list') {
    grid.classList.add('list-view');
    btn.textContent = '⊞ GRID';
  } else {
    grid.classList.remove('list-view');
    btn.textContent = '☰ LIST';
  }
}

function setSortMode(mode) { sortMode = mode; runSearch(); }

function quickStatus(title, status) {
  if (STATUS[title] === status) delete STATUS[title];
  else STATUS[title] = status;
  saveStatus();
  runSearch();
}

function surpriseMeWatchlist() {
  surpriseItem = null;
  const pool = ALL.filter(item => STATUS[item.title] === 'want');
  if (!pool.length) {
    const btn = document.getElementById('sfWant');
    if (btn) { btn.style.background = 'var(--accent2)'; setTimeout(() => btn.style.background = '', 600); }
    return;
  }
  surpriseItem = pool[Math.floor(Math.random() * pool.length)];
  setStatusFilter('want');
}

function exportWatchlist() {
  const items = ALL.filter(item => STATUS[item.title] === 'want');
  if (!items.length) {
    const btn = document.getElementById('sfWant');
    if (btn) { btn.style.background = 'var(--accent2)'; setTimeout(() => btn.style.background = '', 700); }
    return;
  }
  const csv = 'Title,Year,Category,Genres\n' + items.map(item =>
    `"${item.clean.replace(/"/g,'""')}","${item.year || ''}","${CAT[item.cat].label}","${item.tags.join('/')}"`
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vault-watchlist-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// SEARCH ENGINE
// ============================================================
function getFiltered() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const dec = document.getElementById('decadeFilter')?.value;
  const moodGenres = new Set();
  activeMoods.forEach(m => (MOOD_GENRE[m] || []).forEach(g => moodGenres.add(g)));

  let results = ALL.filter(item => {
    if (activeTypes.size && !activeTypes.has(item.cat)) return false;
    if (dec === 'pre1960') { if (!item.year || item.year >= 1960) return false; }
    else if (dec && item.decade !== +dec) return false;
    if (moodGenres.size && !item.tags.some(t => moodGenres.has(t))) return false;
    if (activeGenres.size && ![...activeGenres].every(g => item.tags.includes(g))) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    const st = effectiveStatus(item.title);
    if (statusFilter === 'unwatched' && st) return false;
    if (statusFilter === 'want' && st !== 'want') return false;
    if (statusFilter === 'watched' && st !== 'watched') return false;
    return true;
  });

  if (sortMode === 'year-desc') results.sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (sortMode === 'year-asc') results.sort((a, b) => (a.year || 9999) - (b.year || 9999));
  else if (sortMode === 'az') results.sort((a, b) => a.clean.localeCompare(b.clean));
  else if (sortMode === 'za') results.sort((a, b) => b.clean.localeCompare(a.clean));
  else if (sortMode === 'watchlist') {
    results.sort((a, b) => (STATUS[b.title] === 'want' ? 1 : 0) - (STATUS[a.title] === 'want' ? 1 : 0));
  }

  return results;
}

function buildGenreFilters() {
  const counts = {};
  ALL.forEach(item => item.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([g]) => g);

  const row = document.getElementById('genreFilterRow');
  row.querySelectorAll('.filter-btn').forEach(b => b.remove());
  top.forEach(g => {
    const btn = document.createElement('div');
    btn.className = 'filter-btn' + (activeGenres.has(g) ? ' active' : '');
    btn.textContent = g.charAt(0).toUpperCase() + g.slice(1);
    btn.addEventListener('click', () => toggleGenre(btn, g));
    row.appendChild(btn);
  });
}

function buildFilterSummary() {
  const parts = [];
  const statusLabels = { unwatched: 'Unwatched', want: 'Watchlist', watched: 'Watched' };
  if (statusFilter !== 'all') parts.push(statusLabels[statusFilter]);
  activeTypes.forEach(t => parts.push(CAT[t].label));
  activeGenres.forEach(g => parts.push(g.charAt(0).toUpperCase() + g.slice(1)));
  activeMoods.forEach(m => parts.push(m));
  const dec = document.getElementById('decadeFilter')?.value;
  if (dec === 'pre1960') parts.push('Classic (pre-1960)');
  else if (dec) parts.push(dec + 's');
  const q = (document.getElementById('searchInput')?.value || '').trim();
  if (q) parts.push(`"${q}"`);
  return parts;
}

function runSearch() { surpriseItem = null; renderResults(getFiltered()); }

function surpriseMe() {
  surpriseItem = null;
  const pool = getFiltered();
  if (!pool.length) { runSearch(); return; }
  surpriseItem = pool[Math.floor(Math.random() * pool.length)];
  renderResults(pool);
}

function renderResults(results) {
  const grid = document.getElementById('resultsGrid');
  const meta = document.getElementById('resultsMeta');
  const filterParts = buildFilterSummary();
  const countText = filterParts.length
    ? `${results.length.toLocaleString()} result${results.length !== 1 ? 's' : ''}`
    : `All ${ALL.length.toLocaleString()} titles`;
  meta.textContent = filterParts.length ? `${countText} · ${filterParts.join(' · ')}` : countText;
  grid.innerHTML = '';

  if (surpriseItem) {
    const sc = document.createElement('div'); sc.className = 'surprise-card';
    sc.innerHTML = `<div class="sc-emoji">${CAT[surpriseItem.cat].icon}</div>
      <div class="sc-body"><div class="sc-label">🎲 Tonight's Pick</div>
      <div class="sc-title">${x(surpriseItem.clean)}</div>
      <div class="sc-meta">${CAT[surpriseItem.cat].label}${surpriseItem.year ? ' · ' + surpriseItem.year : ''}${surpriseItem.tags.length ? ' · ' + surpriseItem.tags.slice(0,3).join(', ') : ''}</div></div>
      <button class="sc-again" onclick="surpriseMe()">🎲 AGAIN</button>`;
    grid.appendChild(sc);
  }

  if (!results.length) {
    const e = document.createElement('div'); e.className = 'no-results';
    const filterParts = buildFilterSummary();
    const hint = filterParts.length > 1 ? 'Try removing one of the filters.' : 'Try a different search.';
    e.innerHTML = `<div class="nr-icon">🔍</div><div>Nothing matches${filterParts.length ? ' <em>' + filterParts.join(' + ') + '</em>' : ''}.<br>${hint}</div>`;
    grid.appendChild(e); return;
  }

  results.slice(0, 250).forEach(item => {
    const st = effectiveStatus(item.title);
    const wiz = WIZ_WATCHED[item.title];
    const itemMeta = META[item.title] || {};
    const rating = itemMeta.rating;
    const hasNote = !!itemMeta.note;
    const c = document.createElement('div');
    c.className = 'result-card' +
      (st === 'watched' ? ' is-watched' : '') +
      (st === 'want' ? ' is-want' : '');

    const tagsHtml = item.tags.slice(0, 3).map(t => `<span class="rc-tag">${t}</span>`).join('');
    const personalHtml = (rating || hasNote || wiz) ? `<div class="rc-personal">
      ${rating ? `<span class="rc-stars">${'★'.repeat(rating)}</span>` : ''}
      ${hasNote ? `<span class="rc-has-note">📝</span>` : ''}
      ${wiz ? `<span class="rc-wiz" title="Logged via wiz watch${wiz.dateWatched ? ' on ' + wiz.dateWatched : ''}">${wiz.rating ? '💀'.repeat(wiz.rating) : '⬡ wiz'}</span>` : ''}
    </div>` : '';
    const posterPath = METADATA[item.title]?.poster;
    const posterHtml = posterPath
      ? `<div class="rc-poster"><img src="https://image.tmdb.org/t/p/w300${posterPath}" loading="lazy" alt="" onerror="this.parentNode.style.display='none'"></div>`
      : '';

    c.innerHTML = `
      ${posterHtml}
      <div class="rc-cat">${CAT[item.cat].icon} ${CAT[item.cat].label}</div>
      <div class="rc-title">${x(item.clean)}</div>
      ${item.year ? `<div class="rc-year">${item.year}</div>` : ''}
      ${tagsHtml ? `<div class="rc-tags">${tagsHtml}</div>` : ''}
      ${personalHtml}
      <div class="rc-actions"></div>`;

    const actions = c.querySelector('.rc-actions');

    const wantBtn = document.createElement('div');
    wantBtn.className = 'rc-action' + (st === 'want' ? ' status-want' : '');
    wantBtn.textContent = st === 'want' ? '★ Listed' : '★ List';
    wantBtn.addEventListener('click', e => { e.stopPropagation(); quickStatus(item.title, 'want'); });
    actions.appendChild(wantBtn);

    const seenBtn = document.createElement('div');
    seenBtn.className = 'rc-action' + (st === 'watched' ? ' status-watched' : '');
    seenBtn.textContent = st === 'watched' ? '✓ Seen' : 'Mark Seen';
    seenBtn.addEventListener('click', e => { e.stopPropagation(); quickStatus(item.title, 'watched'); });
    actions.appendChild(seenBtn);

    c.style.cursor = 'pointer';
    c.addEventListener('click', () => openModal(item));
    grid.appendChild(c);
  });

  if (results.length > 250) {
    const m = document.createElement('div'); m.className = 'more-indicator';
    m.textContent = `+ ${(results.length - 250).toLocaleString()} more — refine your search to narrow down`;
    grid.appendChild(m);
  }

  syncURL();
}

function x(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ============================================================
// DETAIL MODAL
// ============================================================
let currentModalItem = null, pendingRating = 0;

function getSimilar(item, n) {
  return ALL
    .filter(i => i.title !== item.title)
    .map(i => {
      let score = 0;
      item.tags.forEach(t => { if (i.tags.includes(t)) score += 2; });
      if (i.cat === item.cat) score += 1;
      if (item.decade && i.decade && Math.abs(i.decade - item.decade) <= 10) score += 1;
      return { i, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ i }) => i);
}

function openModal(item) {
  currentModalItem = item;
  const existing = META[item.title] || {};
  pendingRating = existing.rating || 0;

  const tmdb = METADATA[item.title] || {};
  const mPoster = document.getElementById('mPoster');
  if (mPoster) {
    if (tmdb.poster) {
      mPoster.src = `https://image.tmdb.org/t/p/w342${tmdb.poster}`;
      mPoster.style.display = '';
    } else {
      mPoster.style.display = 'none';
    }
  }

  document.getElementById('mCat').innerHTML = `${CAT[item.cat].icon} ${CAT[item.cat].label}`;
  document.getElementById('mTitle').textContent = item.clean;
  document.getElementById('mMeta').innerHTML = [
    item.year ? String(item.year) : '',
    item.decade ? `${item.decade}s` : ''
  ].filter(Boolean).join(' · ');
  document.getElementById('mTags').innerHTML = item.tags
    .map(t => `<span class="rc-tag" style="font-size:0.7rem;padding:3px 9px">${t}</span>`)
    .join('');

  const descEl = document.getElementById('mDescription');
  if (descEl) {
    descEl.textContent = tmdb.description || '';
    descEl.style.display = tmdb.description ? '' : 'none';
  }

  updateModalStatusButtons();
  renderModalStars(pendingRating);
  document.getElementById('mNote').value = existing.note || '';
  document.getElementById('mSaved').style.display = 'none';

  const wiz = WIZ_WATCHED[item.title];
  const wizLabel = document.getElementById('mWizLogLabel');
  const wizLog = document.getElementById('mWizLog');
  if (wiz) {
    const notesHtml = (wiz.notes || [])
      .map(n => `<div class="wiz-date">${x(n.timestamp)}</div><div class="wiz-reaction">${x(n.text)}</div>`)
      .join('');
    wizLog.innerHTML = `
      <div class="wiz-log-row">
        ${wiz.rating ? `<span class="wiz-skulls">${'💀'.repeat(wiz.rating)}</span>` : ''}
        <span class="wiz-date">watched ${x(wiz.dateWatched || '')}</span>
      </div>
      ${wiz.reaction ? `<div class="wiz-reaction">${x(wiz.reaction)}</div>` : ''}
      ${notesHtml}`;
    wizLabel.style.display = '';
    wizLog.style.display = '';
  } else {
    wizLabel.style.display = 'none';
    wizLog.style.display = 'none';
  }

  const similar = getSimilar(item, 10);
  const simEl = document.getElementById('mSimilar');
  simEl.innerHTML = '';
  if (similar.length) {
    similar.forEach(s => {
      const el = document.createElement('div');
      el.className = 'similar-item';
      el.innerHTML = `<span class="similar-item-icon">${CAT[s.cat].icon}</span>
        <span class="similar-item-title">${x(s.clean)}</span>
        <span class="similar-item-meta">${s.year || ''} · ${s.tags.slice(0,2).join(', ')}</span>`;
      el.addEventListener('click', () => openModal(s));
      simEl.appendChild(el);
    });
  } else {
    simEl.innerHTML = '<div style="color:var(--muted);font-size:0.8rem">No close matches found.</div>';
  }

  document.getElementById('detailModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('detailModal').style.display = 'none';
  document.body.style.overflow = '';
  currentModalItem = null;
}

function updateModalStatusButtons() {
  if (!currentModalItem) return;
  const st = effectiveStatus(currentModalItem.title);
  const wantBtn = document.getElementById('mBtnWant');
  const seenBtn = document.getElementById('mBtnWatched');
  wantBtn.className = 'modal-status-btn' + (st === 'want' ? ' active-want' : '');
  wantBtn.textContent = st === 'want' ? '★ On Watchlist' : '★ Add to Watchlist';
  seenBtn.className = 'modal-status-btn' + (st === 'watched' ? ' active-watched' : '');
  seenBtn.textContent = st === 'watched' ? '✓ Watched' : '✓ Mark as Watched';
}

function modalToggleStatus(status) {
  if (!currentModalItem) return;
  quickStatus(currentModalItem.title, status);
  updateModalStatusButtons();
}

function renderModalStars(r) {
  const row = document.getElementById('mStarRow');
  row.innerHTML = [1,2,3,4,5].map(n =>
    `<button class="star-btn ${n <= r ? 'filled' : ''}"
      onclick="setModalRating(${n})"
      onmouseover="previewStars(${n})"
      onmouseout="renderModalStars(pendingRating)">${n <= r ? '★' : '☆'}</button>`
  ).join('');
}

function previewStars(n) {
  document.getElementById('mStarRow').querySelectorAll('.star-btn').forEach((b, i) => {
    b.classList.toggle('filled', i < n);
    b.textContent = i < n ? '★' : '☆';
  });
}

function setModalRating(n) {
  pendingRating = pendingRating === n ? 0 : n;
  renderModalStars(pendingRating);
}

function saveModalMeta() {
  if (!currentModalItem) return;
  const note = document.getElementById('mNote').value.trim();
  if (pendingRating || note) {
    META[currentModalItem.title] = { rating: pendingRating, note };
  } else {
    delete META[currentModalItem.title];
  }
  saveMeta();
  const saved = document.getElementById('mSaved');
  saved.style.display = 'inline';
  setTimeout(() => { saved.style.display = 'none'; }, 2000);
  runSearch();
}

// ============================================================
// AI CHAT
// ============================================================
const SYS = `You are a personal media recommendation assistant. You have the user's complete media server library.

LIBRARY (3,319 titles across all categories):
MOVIES: 2001 A Space Odyssey, 28 Days Later, 300, Alien/Aliens, Almost Famous, American Beauty, American History X, American Psycho, Arrival, Back To The Future (trilogy), Bad Boys (series), Batman Begins/Dark Knight, Big Lebowski, Blade Runner/2049, Blazing Saddles, Braveheart, Breakfast Club, Casino, Chinatown, Dark Knight trilogy, Django Unchained, Donnie Darko, Drive, Dune (both), Evil Dead (series), Exorcist, Fargo, Fight Club, Full Metal Jacket, Get Out, Ghostbusters, Gladiator, Goodfellas, Goonies, Hereditary, Her, Inception, Indiana Jones (series), Inglourious Basterds, Interstellar, It/It Chapter Two, John Wick (series), Kill Bill (series), LOTR (trilogy), Mad Max (series), Matrix (trilogy), Memento, Midsommar, No Country For Old Men, Office Space, Oldboy, Once Upon A Time In Hollywood, Oppenheimer, Pan's Labyrinth, Parasite, Prisoners, Pulp Fiction, Rocky (series), Rosemary's Baby, Saving Private Ryan, Se7en, Scream (series), Shaun of the Dead, Shining, Silence of the Lambs, Snatch, Spider-Man (multiple series), Star Wars (series), Star Trek (series), Starship Troopers, Superbad, Terminator (series), Texas Chainsaw (series), The Thing, Thor (series), Tombstone, Total Recall, Trainspotting, Truman Show, Us, Usual Suspects, Witch, Wolf of Wall Street, X-Men (series), Zodiac, Zombieland, + ~2,400 more.

TV: Better Call Saul, Breaking Bad, The Boys, Chernobyl, Dark Winds, Fallout, Fargo, Firefly, Fleabag, Fringe, Game of Thrones, Hannibal, Invincible, Justified, Last of Us, Lost, Lovecraft Country, Mr Robot, Only Murders in the Building, Ozark, Peaky Blinders, Rick and Morty, Severance, Shogun, Silo, Sopranos, Ted Lasso, Terror, True Detective, Wire, Westworld, X-Files, Yellowjackets, + 270 more.

DOCS: 13th, Act of Killing, Baraka, Citizenfour, Enron, Exit Through The Gift Shop, Fog of War, HyperNormalisation, I Am Not Your Negro, Inside Job, King of Kong, Last Dance, Navalny, OJ Simpson Made In America, Paradise Lost (series), Paris Is Burning, Particle Fever, Samsara, West of Memphis, + 70 more.

STANDUP: Dave Chappelle (all specials), George Carlin (multiple), Richard Pryor (multiple), Bo Burnham (all), John Mulaney (all), Norm Macdonald (multiple), Bill Burr (multiple), Eddie Izzard (multiple), Patrice ONeal, Jerrod Carmichael Rothaniel, + 70 more.

MUSIC DOCS: Woodstock, Gimme Shelter, Grateful Dead, Lemmy, Metallica Some Kind of Monster, Long Strange Trip, Beastie Boys Story, Miles Davis Birth of the Cool, Joy Division, One More Time With Feeling, Becoming Led Zeppelin, + ~10 more.

Give specific recommendations from their library. Mention hidden gems. Suggest additions clearly marked. Be like a knowledgeable cinephile friend — direct, opinionated, enthusiastic. Use **Title (Year)** formatting, ## for sections, - for bullets.`;

function setAIPrompt(t) { document.getElementById('aiInput').value=t; autoResize(document.getElementById('aiInput')); document.getElementById('aiInput').focus(); }
function sendQuickPrompt(el) { setAIPrompt(el.textContent.trim()); sendAIMessage(); }
function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,100)+'px'; }
function handleKey(e) { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAIMessage();} }

function addMsg(cls, html) {
  const msgs = document.getElementById('messages');
  const w = document.getElementById('welcome'); if(w) w.remove();
  const d = document.createElement('div'); d.className = 'msg '+cls;
  d.innerHTML = html; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
}

function fmt(t) {
  t = t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  t = t.replace(/^##\s+(.+)$/gm,'<h3>$1</h3>');
  t = t.replace(/^#\s+(.+)$/gm,'<h3>$1</h3>');
  t = t.replace(/^-\s+(.+)$/gm,'<li>$1</li>');
  t = t.replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>');
  t = t.replace(/<\/ul>\s*<ul>/g,'');
  return t.split(/\n\n+/).map(p => {
    p=p.trim(); if(!p) return '';
    if(/^<(h3|ul|li)/.test(p)) return p;
    return `<p>${p.replace(/\n/g,'<br>')}</p>`;
  }).join('');
}

async function sendAIMessage() {
  if(aiLoading) return;
  const input = document.getElementById('aiInput');
  const text = input.value.trim(); if(!text) return;
  input.value=''; input.style.height='auto';
  aiLoading=true; document.getElementById('sendBtn').disabled=true;
  let ctx='';
  if(activeMoods.length) ctx+=` [Mood: ${activeMoods.join(', ')}]`;
  if(activeTypes.size) ctx+=` [Types: ${[...activeTypes].join(', ')}]`;
  addMsg('user',`<div class="msg-bubble">${x(text)}</div>`);
  addMsg('assistant','<div class="thinking" id="thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>');
  aiConv.push({role:'user',content:text+ctx});
  saveAIConv();
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:SYS,messages:aiConv})
    });
    const d = await r.json();
    if(d.error) throw new Error(d.error.message);
    const reply = d.content?.[0]?.text||'No response.';
    aiConv.push({role:'assistant',content:reply});
    saveAIConv();
    document.getElementById('thinking').outerHTML=`<div class="msg assistant"><div class="msg-bubble">${fmt(reply)}</div></div>`;
    aiAvailable=true; updateAIStatus();
    updateChatControls();
  } catch(err) {
    document.getElementById('thinking').outerHTML=`<div class="msg assistant"><div class="msg-bubble"><p>⚠️ AI unavailable. <a href="#" onclick="switchTab('browse');return false;" style="color:var(--accent)">Switch to Browse &amp; Search →</a></p></div></div>`;
    aiAvailable=false; updateAIStatus();
  }
  aiLoading=false;
  document.getElementById('sendBtn').disabled = !aiAvailable;
}

function updateChatControls() {
  const ctrl = document.getElementById('chatControls');
  if (!ctrl) return;
  ctrl.style.display = 'flex';
  const pairs = Math.floor(aiConv.length / 2);
  document.getElementById('chatHistoryNote').textContent =
    `CONTINUING SESSION · ${pairs} EXCHANGE${pairs !== 1 ? 'S' : ''}`;
}

function restoreAIConversation() {
  if (!aiConv.length) return;
  const msgs = document.getElementById('messages');
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
  for (let i = 0; i < aiConv.length; i++) {
    const msg = aiConv[i];
    if (msg.role === 'user') {
      addMsg('user', `<div class="msg-bubble">${x(msg.content.replace(/\[Mood:[^\]]*\]|\[Types:[^\]]*\]/g,'').trim())}</div>`);
    } else if (msg.role === 'assistant') {
      addMsg('assistant', `<div class="msg-bubble">${fmt(msg.content)}</div>`);
    }
  }
  updateChatControls();
}

function newConversation() {
  aiConv = [];
  saveAIConv();
  const msgs = document.getElementById('messages');
  msgs.innerHTML = `<div class="welcome" id="welcome">
    <div class="welcome-icon">🎬</div>
    <h2>What Are You In The Mood For?</h2>
    <p>Tell me a vibe, genre, or something you loved. I know your entire library and I'll find exactly what you need.</p>
    <div class="quick-prompts" id="aiQuickPrompts" ${aiAvailable === false ? 'style="display:none"' : ''}>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">Something like No Country for Old Men</div>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">Best horror I might have missed</div>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">Great standup for tonight</div>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">A documentary that'll change how I think</div>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">90s movies I should revisit</div>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">Best thing to binge this weekend</div>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">Essential titles missing from my library</div>
      <div class="quick-prompt" onclick="sendQuickPrompt(this)">Best music documentary I have</div>
    </div>
    <div class="quick-prompts" id="offlineQuickActions" ${aiAvailable !== false ? 'style="display:none"' : ''}>
      <div class="quick-prompt" onclick="offlineBrowse({})">🔍 Browse everything</div>
      <div class="quick-prompt" onclick="offlineBrowse({surprise:true})">🎲 Surprise me tonight</div>
      <div class="quick-prompt" onclick="offlineBrowse({status:'want'})">★ My Watchlist</div>
      <div class="quick-prompt" onclick="offlineBrowse({genre:'horror'})">🩸 Horror</div>
      <div class="quick-prompt" onclick="offlineBrowse({genre:'comedy'})">😂 Comedy</div>
      <div class="quick-prompt" onclick="offlineBrowse({decade:'1990'})">📼 Best of the 90s</div>
    </div>
  </div>`;
  const ctrl = document.getElementById('chatControls');
  if (ctrl) ctrl.style.display = 'none';
}

// ============================================================
// FALL 2026
// ============================================================
function xa(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const FALL_PLATFORM_LABELS = { netflix: 'Netflix', apple: 'Apple TV', hboMax: 'HBO Max', peacock: 'Peacock' };

function fallOwnedPill(item) {
  const yearHtml = item.year ? `<span class="fall-pill-year">${item.year}</span>` : '';
  const libItem = item.libraryKey && ALL.find(i => i.title === item.libraryKey);
  if (libItem) {
    return `<span class="fall-pill owned" title="${xa(item.note || '')}" data-fall-key="${xa(item.libraryKey)}">${x(item.title)}${yearHtml}</span>`;
  }
  return `<span class="fall-pill missing" title="${xa(item.note || '')}">${x(item.title)}${yearHtml}</span>`;
}

function fallMissingPill(item) {
  const yearHtml = item.year ? `<span class="fall-pill-year">${item.year}</span>` : '';
  const tip = [item.platform, item.note].filter(Boolean).join(' — ');
  return `<span class="fall-pill missing" title="${xa(tip)}">${item.focused ? '⚡ ' : ''}${x(item.title)}${yearHtml}</span>`;
}

function fallListItem(item) {
  const metaParts = [];
  if (item.year) metaParts.push(item.year);
  if (item.platform) metaParts.push(item.platform);
  if (item.date) metaParts.push(item.date);
  const star = item.fillsGap ? '<span class="fall-item-star">⭐</span> ' : '';
  const focused = item.focused ? '⚡ ' : '';
  const libItem = item.libraryKey && ALL.find(i => i.title === item.libraryKey);
  return `
    <div class="fall-item${item.fillsGap ? ' fills-gap' : ''}${libItem ? ' fall-clickable' : ''}"${libItem ? ` data-fall-key="${xa(item.libraryKey)}"` : ''}>
      <div class="fall-item-top">
        <span class="fall-item-title">${star}${focused}${x(item.title)}</span>
        ${metaParts.length ? `<span class="fall-item-meta">${x(metaParts.join(' · '))}</span>` : ''}
      </div>
      ${item.note ? `<div class="fall-item-note">${x(item.note)}</div>` : ''}
    </div>`;
}

let fallListenerBound = false;
function renderFall() {
  const el = document.getElementById('fallContent');
  if (!el || typeof FALL_2026 === 'undefined') return;

  const parts = [];

  parts.push(`
    <div class="fall-intro">
      <h2>🍂 Fall 2026 — Spooky Season by Theme</h2>
      <p>${x(FALL_2026.intro)}</p>
      <div class="fall-checked">Checked ${x(FALL_2026.checkedDate)}</div>
    </div>
    <div class="fall-start-here"><strong>Start here:</strong> ${x(FALL_2026.startHere)}</div>`);

  FALL_2026.themes.forEach(theme => {
    parts.push(`
      <div class="fall-section">
        <div class="fall-section-header">
          <span class="fall-section-num">${theme.n}</span>
          <span class="fall-section-title">${x(theme.title)}</span>
        </div>
        <div class="fall-section-tagline">${x(theme.tagline)}</div>
        <div class="fall-group-label">In the Vault</div>
        <div class="fall-pills">${theme.owned.map(fallOwnedPill).join('')}</div>
        <div class="fall-group-label">Missing</div>
        ${theme.missingNote ? `<div class="fall-missing-note">${x(theme.missingNote)}</div>` : ''}
        <div class="fall-pills">${theme.missing.map(fallMissingPill).join('')}</div>
      </div>`);
  });

  parts.push(`
    <div class="fall-section">
      <div class="fall-section-header"><span class="fall-section-title">New This Season</span></div>
      <div class="fall-list">${FALL_2026.newThisSeason.map(fallListItem).join('')}</div>
    </div>`);

  parts.push(`
    <div class="fall-section">
      <div class="fall-section-header"><span class="fall-section-title">📺 Where to Stream It — Our Services</span></div>
      <div class="fall-section-tagline">${x(FALL_2026.streaming.note)}</div>
      ${Object.keys(FALL_PLATFORM_LABELS).map(key => `
        <div class="fall-streaming-group">
          <h3>${FALL_PLATFORM_LABELS[key]}</h3>
          <div class="fall-list">${FALL_2026.streaming[key].map(fallListItem).join('')}</div>
        </div>`).join('')}
    </div>`);

  el.innerHTML = parts.join('');

  if (!fallListenerBound) {
    el.addEventListener('click', e => {
      const target = e.target.closest('[data-fall-key]');
      if (!target) return;
      const libItem = ALL.find(i => i.title === target.dataset.fallKey);
      if (libItem) openModal(libItem);
    });
    fallListenerBound = true;
  }
}

// ============================================================
// URL PERSISTENCE
// ============================================================
function syncURL() {
  const params = new URLSearchParams();
  if (activeGenres.size) params.set('genre', [...activeGenres].join(','));
  if (activeTypes.size) params.set('type', [...activeTypes].join(','));
  if (activeMoods.length) params.set('mood', activeMoods.join(','));
  const dec = document.getElementById('decadeFilter')?.value;
  if (dec) params.set('decade', dec);
  const q = (document.getElementById('searchInput')?.value || '').trim();
  if (q) params.set('q', q);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (sortMode !== 'default') params.set('sort', sortMode);
  if (viewMode !== 'grid') params.set('view', viewMode);
  const str = params.toString();
  history.replaceState(null, '', str ? '?' + str : location.pathname);
}

function restoreFromURL() {
  const params = new URLSearchParams(location.search);
  if (!params.size) return;

  if (params.has('genre')) params.get('genre').split(',').forEach(g => activeGenres.add(g));
  if (params.has('type')) params.get('type').split(',').forEach(t => {
    activeTypes.add(t);
    document.getElementById(`tp-${t}`)?.classList.add('active');
  });
  if (params.has('mood')) params.get('mood').split(',').forEach(m => {
    activeMoods.push(m);
    document.querySelectorAll('.chip').forEach(el => {
      if (el.textContent.trim().includes(m)) el.classList.add('active');
    });
  });
  if (params.has('decade')) {
    const el = document.getElementById('decadeFilter');
    if (el) el.value = params.get('decade');
  }
  if (params.has('q')) {
    const el = document.getElementById('searchInput');
    if (el) el.value = params.get('q');
  }
  if (params.has('status')) {
    statusFilter = params.get('status');
    document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    const map = { all:'sfAll', unwatched:'sfUnwatched', want:'sfWant', watched:'sfWatched' };
    document.getElementById(map[statusFilter])?.classList.add('active');
  }
  if (params.has('sort')) {
    sortMode = params.get('sort');
    const el = document.getElementById('sortSelect');
    if (el) el.value = sortMode;
  }
  if (params.has('view') && params.get('view') === 'list') {
    viewMode = 'list';
    document.getElementById('resultsGrid')?.classList.add('list-view');
    const btn = document.getElementById('viewToggleBtn');
    if (btn) btn.textContent = '⊞ GRID';
  }
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

  if (e.key === '/' && !inInput) {
    e.preventDefault();
    switchTab('browse');
    document.getElementById('searchInput').focus();
  }

  if (e.key === 'Escape') {
    if (document.getElementById('detailModal').style.display !== 'none') {
      closeModal();
    } else if (!inInput) {
      clearAllFilters();
    } else {
      document.activeElement.blur();
    }
  }
});

// ============================================================
// INIT
// ============================================================
// Overlay wiz watch log (wiz-watched.js, regenerated by wiz-dashboard) — match by slugified title
if (typeof WIZ_FILMS !== 'undefined') {
  const bySlug = {};
  WIZ_FILMS.forEach(f => { bySlug[f.slug] = f; });
  ALL.forEach(item => {
    const slug = item.clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (bySlug[slug]) WIZ_WATCHED[item.title] = bySlug[slug];
  });
}

loadPersisted();
restoreFromURL();    // populate state before building genre buttons
buildGenreFilters(); // reads activeGenres to apply .active on restored genres
if (AI_ENABLED) {
  restoreAIConversation();
  checkAI();
} else {
  document.getElementById('tabAI').style.display = 'none';
  document.getElementById('aiQuickModes').style.display = 'none';
  switchTab('browse');
}
if (location.search) switchTab('browse'); // URL params always land on Browse
runSearch();
