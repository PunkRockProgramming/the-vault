// Build flat list with genre overrides
const ALL = [];
Object.entries(RAW).forEach(([cat, titles]) => {
  titles.forEach(title => {
    const ym = title.match(/\((\d{4})\)/);
    const year = ym ? +ym[1] : null;
    const decade = year ? Math.floor(year/10)*10 : null;
    const clean = title.replace(/\s*\(\d{4}\)\s*/,'').trim();
    const lc = title.toLowerCase();
    const tags = GENRE_OVERRIDES[title]
      ? [...GENRE_OVERRIDES[title]]
      : Object.entries(GENRE_KW).filter(([,kws]) => kws.some(k => lc.includes(k))).map(([g]) => g);
    ALL.push({ title, clean, cat, year, decade, tags });
  });
});


// ============================================================
// STATE
// ============================================================
let activeMoods = [], activeTypes = new Set(), activeGenres = new Set();
let aiConv = [], aiLoading = false, aiAvailable = null, surpriseItem = null;

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
  if (aiAvailable) {
    dot.className = 'ai-dot'; txt.textContent = 'AI ONLINE'; banner.style.display = 'none';
  } else {
    dot.className = 'ai-dot offline'; txt.textContent = 'AI OFFLINE'; banner.style.display = 'flex';
    const tab = document.getElementById('tabBrowse');
    if (!tab.querySelector('.tab-badge')) {
      const b = document.createElement('span'); b.className = 'tab-badge'; b.textContent = 'USE THIS'; tab.appendChild(b);
    }
  }
}

// ============================================================
// TABS
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  if (tab === 'ai') {
    document.getElementById('tabAI').classList.add('active');
    document.getElementById('panelAI').classList.add('active');
    document.getElementById('aiQuickModes').style.display = '';
  } else {
    document.getElementById('tabBrowse').classList.add('active');
    document.getElementById('panelBrowse').classList.add('active');
    document.getElementById('aiQuickModes').style.display = 'none';
    runSearch();
  }
}

// ============================================================
// SIDEBAR
// ============================================================
function toggleMood(el, mood) {
  el.classList.toggle('active');
  if (el.classList.contains('active')) activeMoods.push(mood); else activeMoods = activeMoods.filter(m=>m!==mood);
  if (document.getElementById('panelBrowse').classList.contains('active')) runSearch();
}

function toggleType(el, type) {
  el.classList.toggle('active');
  if (el.classList.contains('active')) activeTypes.add(type); else activeTypes.delete(type);
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
  document.getElementById('searchInput').value = '';
  document.getElementById('decadeFilter').value = '';
  runSearch();
}

// ============================================================
// SEARCH ENGINE
// ============================================================
function getFiltered() {
  const q = (document.getElementById('searchInput')?.value||'').toLowerCase().trim();
  const dec = document.getElementById('decadeFilter')?.value;
  const moodGenres = new Set(); activeMoods.forEach(m => (MOOD_GENRE[m]||[]).forEach(g=>moodGenres.add(g)));
  const allGenres = new Set([...activeGenres,...moodGenres]);
  return ALL.filter(item => {
    if (activeTypes.size && !activeTypes.has(item.cat)) return false;
    if (dec && item.decade !== +dec) return false;
    if (allGenres.size && !item.tags.some(t=>allGenres.has(t))) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

function runSearch() { surpriseItem = null; renderResults(getFiltered()); }

function surpriseMe() {
  surpriseItem = null;
  const pool = getFiltered();
  if (!pool.length) { runSearch(); return; }
  surpriseItem = pool[Math.floor(Math.random()*pool.length)];
  renderResults(pool);
}

function renderResults(results) {
  const grid = document.getElementById('resultsGrid');
  const meta = document.getElementById('resultsMeta');
  const hasF = activeTypes.size||activeGenres.size||activeMoods.length||(document.getElementById('searchInput')?.value||'').trim()||(document.getElementById('decadeFilter')?.value);
  meta.textContent = hasF ? `${results.length.toLocaleString()} result${results.length!==1?'s':''} found` : `All ${ALL.length.toLocaleString()} titles`;
  grid.innerHTML = '';

  if (surpriseItem) {
    const sc = document.createElement('div'); sc.className = 'surprise-card';
    sc.innerHTML = `<div class="sc-emoji">${CAT[surpriseItem.cat].icon}</div>
      <div class="sc-body"><div class="sc-label">🎲 Tonight's Pick</div>
      <div class="sc-title">${x(surpriseItem.clean)}</div>
      <div class="sc-meta">${CAT[surpriseItem.cat].label}${surpriseItem.year?' · '+surpriseItem.year:''}${surpriseItem.tags.length?' · '+surpriseItem.tags.slice(0,3).join(', '):''}</div></div>
      <button class="sc-again" onclick="surpriseMe()">🎲 AGAIN</button>`;
    grid.appendChild(sc);
  }

  if (!results.length) {
    const e = document.createElement('div'); e.className = 'no-results';
    e.innerHTML = '<div class="nr-icon">🔍</div><div>No results match.<br>Try clearing some filters.</div>';
    grid.appendChild(e); return;
  }

  results.slice(0,250).forEach(item => {
    const c = document.createElement('div'); c.className = 'result-card';
    const tagsHtml = item.tags.slice(0,3).map(t=>`<span class="rc-tag">${t}</span>`).join('');
    c.innerHTML = `<div class="rc-cat">${CAT[item.cat].icon} ${CAT[item.cat].label}</div>
      <div class="rc-title">${x(item.clean)}</div>
      ${item.year?`<div class="rc-year">${item.year}</div>`:''}
      ${tagsHtml?`<div class="rc-tags">${tagsHtml}</div>`:''}`;
    grid.appendChild(c);
  });

  if (results.length > 250) {
    const m = document.createElement('div'); m.className = 'more-indicator';
    m.textContent = `+ ${(results.length-250).toLocaleString()} more — refine your search to narrow down`;
    grid.appendChild(m);
  }
}

function x(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:SYS,messages:aiConv})
    });
    const d = await r.json();
    if(d.error) throw new Error(d.error.message);
    const reply = d.content?.[0]?.text||'No response.';
    aiConv.push({role:'assistant',content:reply});
    document.getElementById('thinking').outerHTML=`<div class="msg assistant"><div class="msg-bubble">${fmt(reply)}</div></div>`;
    aiAvailable=true; updateAIStatus();
  } catch(err) {
    document.getElementById('thinking').outerHTML=`<div class="msg assistant"><div class="msg-bubble"><p>⚠️ AI unavailable. <a href="#" onclick="switchTab('browse');return false;" style="color:var(--accent)">Switch to Browse &amp; Search →</a></p></div></div>`;
    aiAvailable=false; updateAIStatus();
  }
  aiLoading=false; document.getElementById('sendBtn').disabled=false;
}

// ============================================================
// INIT
// ============================================================
checkAI();
runSearch();
