// ===== iGreen Academy — área de membros (mobile-first) =====

// Thumbnail LEVE do YouTube (mqdefault ~ 320x180, sempre existe). Bem mais rápido.
function thumb(yt) { return `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`; }

// ---------- PROGRESSO (localStorage) ----------
const STORE_KEY = "igreen_progress_v2";
const LAST_KEY = "igreen_last_v2";
let PROGRESS = load(STORE_KEY) || {};
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function getProg(yt) { return PROGRESS[yt] || { pct: 0, done: false }; }
function setProg(yt, pct, done) {
  const cur = getProg(yt);
  const newPct = Math.max(cur.pct || 0, Math.round(pct));
  PROGRESS[yt] = { pct: newPct, done: done || cur.done || newPct >= 95 };
  save(STORE_KEY, PROGRESS);
  refreshLessonUI(yt);
  updateModuleProgress();
  updateStats();
  updateResume();
}

// ---------- PROVAS / EXAMES ----------
const EXAM_KEY = "igreen_exams_v1";
let EXAMS = load(EXAM_KEY) || {};
function getExam(key) { return EXAMS[key]; }
function setExam(key, score, passed) {
  const cur = EXAMS[key];
  // mantém o melhor resultado
  if (!cur || score > cur.score) EXAMS[key] = { score, passed: passed || (cur && cur.passed) };
  else if (passed && cur) cur.passed = true;
  save(EXAM_KEY, EXAMS);
}
function passedExamsCount() {
  return Object.values(EXAMS).filter(e => e.passed).length;
}
function currentLevel() {
  const n = passedExamsCount();
  let lvl = KNOWLEDGE_LEVELS[0];
  for (const l of KNOWLEDGE_LEVELS) { if (n >= l.min) lvl = l; }
  return lvl;
}
function nextLevel() {
  const n = passedExamsCount();
  return KNOWLEDGE_LEVELS.find(l => l.min > n) || null;
}

// ---------- Lista linear (ordem trilha -> módulo -> aula) ----------
const ALL = [];
CATALOG.forEach((cat, ci) => {
  (cat.modules || []).forEach((mod, mi) => {
    mod.lessons.forEach((l, li) => {
      ALL.push({ ...l, catId: cat.id, catTitle: cat.title, color: cat.color,
        moduleTitle: mod.title, catIndex: ci, moduleIndex: mi, lessonIndex: li });
    });
  });
});
const idxOf = (yt) => ALL.findIndex(l => l.yt === yt);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============ RENDER DO CATÁLOGO ============
const catalogEl = document.getElementById('catalog');

// Ícone temático por trilha (mantido apenas para detalhe decorativo sutil)
const CAT_ICON = {
  intro: '<path d="M12 2 4.5 6v6c0 4.5 3.2 8.7 7.5 10 4.3-1.3 7.5-5.5 7.5-10V6L12 2zm0 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/>',
  livre: '<path d="M11 21h-1l1-7H6l7-11h1l-1 7h5l-7 11z"/>',
  green: '<path d="M6 21c-1-7 3-13 12-15 0 9-4 14-12 15zm0 0c0-4 1-7 4-9"/>',
  placas: '<path d="M3 14h18l-2-9H5l-2 9zm9 0v6m-5 0h10M8 8h2m3 0h2"/>',
  solar: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  telecom: '<path d="M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm5 16v.01"/>',
  expansao: '<path d="M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm14-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-7 3a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 0 5-5M9.5 13.5 6.5 17"/>',
  entenda: '<path d="M12 3a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11zm-2 18h4"/>',
  cast: '<path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm-6 8a6 6 0 0 0 12 0M12 17v4m-3 0h6"/>',
  'cap-solar': '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  'cap-venda-solar': '<path d="M3 3h2l2.4 12.3a1 1 0 0 0 1 .7h9.2a1 1 0 0 0 1-.8L21 8H6m3 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>',
  'cap-vendas': '<path d="M3 17l6-6 4 4 7-8m0 0h-5m5 0v5"/>',
  'cap-telecom': '<path d="M2 7.5C8 4 16 4 22 7.5M5 11c4.5-2.5 9.5-2.5 14 0M8.5 14.5c2-1 5-1 7 0M12 18.5v.01"/>',
  'cap-seguros': '<path d="M12 2 4.5 6v6c0 4.5 3.2 8.7 7.5 10 4.3-1.3 7.5-5.5 7.5-10V6L12 2zm-1.5 13L7 11.5l1.4-1.4 2.1 2.1 4.1-4.1L16 9.5 10.5 15z"/>',
  'igreen-treinamentos': '<path d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zm0 13.5L4 12m8 4.5L20 12"/>',
  'igreen-placas': '<path d="M3 14h18l-2-9H5l-2 9zm9 0v6m-5 0h10M8 8h2m3 0h2"/>',
  'igreen-telecom2': '<path d="M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm5 16v.01"/>',
  'igreen-seguros2': '<path d="M12 2 4.5 6v6c0 4.5 3.2 8.7 7.5 10 4.3-1.3 7.5-5.5 7.5-10V6L12 2zm-1.5 13L7 11.5l1.4-1.4 2.1 2.1 4.1-4.1L16 9.5 10.5 15z"/>',
  'igreen-lideranca': '<path d="M16 11a4 4 0 1 0-8 0M2 21v-1a6 6 0 0 1 12 0v1M19 8l2 2 4-4"/>',
  'igreen-carreira': '<path d="M3 17l6-6 4 4 7-8m0 0h-5m5 0v5"/>',
};

function lessonRow(lesson, num, cat) {
  const c = (cat && cat.color) || lesson.color || '#1db954';
  const catId = (cat && cat.id) || lesson.catId;
  const p = getProg(lesson.yt);
  const stateClass = p.done ? 'is-done' : (p.pct > 0 ? 'is-progress' : '');
  const badge = p.done ? '<span class="poster__tag poster__tag--done">✓ Concluída</span>'
              : (p.pct > 0 ? `<span class="poster__tag poster__tag--prog">${p.pct}%</span>` : '');
  const aula = String(num).padStart(2, '0');
  // Usa a thumbnail REAL do YouTube como capa (mostra o conteúdo da aula)
  return `
    <div class="poster ${stateClass}" data-yt="${lesson.yt}" style="--c:${c}">
      <div class="poster__art">
        <div class="poster__thumb">
          <img loading="lazy" src="${thumb(lesson.yt)}" alt="${escapeHtml(lesson.title)}" />
        </div>
        <div class="poster__panel">
          <span class="poster__aula">AULA ${aula}</span>
          <span class="poster__title">${escapeHtml(lesson.title)}</span>
          ${badge}
        </div>
        <span class="poster__check"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span>
        <span class="poster__play"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z"/></svg></span>
        <div class="poster__progress"><span style="width:${p.pct || 0}%"></span></div>
      </div>
    </div>`;
}

function moduleBlock(cat, mod, mi) {
  const lessonsHtml = mod.lessons.map((l, li) => lessonRow({ ...l, catId: cat.id, catTitle: cat.title }, li + 1, cat)).join('');
  const cert = mod.certificate ? '<span class="module__cert">🎓 Certificado</span>' : '';
  const quizKey = `${cat.id}-${mi}`;
  const hasQuiz = typeof QUIZZES !== 'undefined' && QUIZZES[quizKey];
  const examState = getExam(quizKey);
  let examBtn = '';
  if (hasQuiz) {
    const passed = examState && examState.passed;
    examBtn = `<button class="module__exam ${passed ? 'passed' : ''}" data-quiz="${quizKey}">
      ${passed ? `🏆 Aprovado · ${examState.score}%` : '📝 Fazer prova'}
    </button>`;
  }
  return `
    <div class="module" data-cat="${cat.id}" data-mod="${mi}">
      <button class="module__head">
        <span class="module__badge" style="background:${cat.color}">${mi + 1}</span>
        <span class="module__info">
          <span class="module__title">${escapeHtml(mod.title)}</span>
          <span class="module__meta">
            <span class="module__count">${mod.lessons.length} ${mod.lessons.length === 1 ? 'aula' : 'aulas'}</span>
            ${cert}
            <span class="module__prog" data-cat="${cat.id}" data-mod="${mi}"></span>
          </span>
        </span>
        <span class="module__chev"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg></span>
      </button>
      <div class="module__track"><span data-cat="${cat.id}" data-mod="${mi}"></span></div>
      <div class="module__lessons">${lessonsHtml}</div>
      ${hasQuiz ? `<div class="module__examrow">${examBtn}</div>` : ''}
    </div>`;
}

function renderCatalog() {
  let lastSection = 'oficial';
  catalogEl.innerHTML = CATALOG.map(cat => {
    const totalAulas = (cat.modules || []).reduce((s, m) => s + m.lessons.length, 0);
    const numMods = (cat.modules || []).length;
    const mods = cat.modules.map((mod, mi) => moduleBlock(cat, mod, mi)).join('');
    // define a seção da trilha
    let section = 'oficial';
    if (cat.id.startsWith('igreen-')) section = 'igreen-pratica';
    else if (cat.id.startsWith('cap-')) section = 'capacitacao';
    const extra = section === 'capacitacao' ? '<span class="trilha__extra">Externo</span>' : '';
    let divider = '';
    if (section !== lastSection) {
      lastSection = section;
      const txt = section === 'igreen-pratica'
        ? '🚀 Treinamentos iGreen na Prática · Aprenda com quem já faz acontecer'
        : '📚 Capacitação Profissional · Vendas, técnica e mercado para seus consultores';
      divider = `
        <div class="section-divider">
          <span class="section-divider__line"></span>
          <span class="section-divider__text">${txt}</span>
          <span class="section-divider__line"></span>
        </div>`;
    }
    return `${divider}
      <section class="trilha">
        <div class="trilha__head" style="--accent:${cat.color}">
          <span class="trilha__title">${escapeHtml(cat.title)}</span>
          ${extra}
          <span class="trilha__meta">${numMods} ${numMods === 1 ? 'módulo' : 'mód.'} · ${totalAulas} aulas</span>
        </div>
        ${mods}
      </section>`;
  }).join('');

  // accordion: clicar no cabeçalho abre/fecha
  catalogEl.querySelectorAll('.module__head').forEach(head => {
    head.addEventListener('click', () => head.closest('.module').classList.toggle('open'));
  });
  // clique no pôster -> abre player
  catalogEl.querySelectorAll('.poster').forEach(row => {
    row.addEventListener('click', () => openPlayer(idxOf(row.dataset.yt)));
  });
  // clique no botão de prova
  catalogEl.querySelectorAll('.module__exam').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openQuiz(btn.dataset.quiz); });
  });

  updateModuleProgress();
  updateLevel();
}

// progresso por módulo (texto + mini barra)
function updateModuleProgress() {
  document.querySelectorAll('.module__prog').forEach(el => {
    const cat = CATALOG.find(c => c.id === el.dataset.cat);
    if (!cat) return;
    const mod = cat.modules[Number(el.dataset.mod)];
    const done = mod.lessons.filter(l => getProg(l.yt).done).length;
    const total = mod.lessons.length;
    el.textContent = `· ${done}/${total}`;
    el.classList.toggle('done', done === total && total > 0);
  });
  document.querySelectorAll('.module__track span').forEach(el => {
    const cat = CATALOG.find(c => c.id === el.dataset.cat);
    if (!cat) return;
    const mod = cat.modules[Number(el.dataset.mod)];
    const done = mod.lessons.filter(l => getProg(l.yt).done).length;
    el.style.width = (done / mod.lessons.length * 100) + '%';
  });
}

function refreshLessonUI(yt) {
  const p = getProg(yt);
  document.querySelectorAll(`.poster[data-yt="${yt}"]`).forEach(row => {
    row.classList.toggle('is-done', !!p.done);
    row.classList.toggle('is-progress', !p.done && p.pct > 0);
    const bar = row.querySelector('.poster__progress span');
    if (bar) bar.style.width = (p.pct || 0) + '%';
    const tag = row.querySelector('.poster__tag');
    if (tag) {
      if (p.done) { tag.className = 'poster__tag poster__tag--done'; tag.textContent = '✓ Concluída'; }
      else if (p.pct > 0) { tag.className = 'poster__tag poster__tag--prog'; tag.textContent = p.pct + '% assistido'; }
      else { tag.className = 'poster__tag poster__tag--new'; tag.textContent = '▶ Assistir'; }
    }
  });
  // também atualiza linhas da playlist do player
  document.querySelectorAll(`.lesson[data-yt="${yt}"]`).forEach(row => {
    row.classList.toggle('is-done', !!p.done);
    const st = row.querySelector('.lesson__state');
    if (st) st.textContent = p.done ? 'Concluída' : (p.pct > 0 ? `${p.pct}% assistido` : 'Não iniciada');
  });
}

// ============ ESTATÍSTICAS + RESUME ============
function updateStats() {
  const total = ALL.length;
  const done = ALL.filter(l => getProg(l.yt).done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById('statPct').textContent = pct + '%';
  document.getElementById('statBar').style.width = pct + '%';
  document.getElementById('statDone').textContent = `${done} de ${total} aulas concluídas`;
  const ex = document.getElementById('examsSummary');
  if (ex) {
    const totalQuiz = typeof QUIZZES !== 'undefined' ? Object.keys(QUIZZES).length : 0;
    ex.textContent = `🏆 ${passedExamsCount()} de ${totalQuiz} provas aprovadas`;
  }
}

// ---------- NÍVEL DE CONHECIMENTO ----------
function updateLevel() {
  const lvl = currentLevel();
  const nxt = nextLevel();
  const iconEl = document.getElementById('levelIcon');
  const nameEl = document.getElementById('levelName');
  const descEl = document.getElementById('levelDesc');
  const nextEl = document.getElementById('levelNext');
  if (iconEl) iconEl.textContent = lvl.icon;
  if (nameEl) nameEl.textContent = lvl.name;
  if (descEl) descEl.textContent = lvl.desc;
  if (nextEl) {
    if (nxt) {
      const faltam = nxt.min - passedExamsCount();
      nextEl.innerHTML = `<span class="level-card__nexticon">${nxt.icon}</span><span>Faltam <b>${faltam}</b> prova(s)<br>para <b>${nxt.name}</b></span>`;
    } else {
      nextEl.innerHTML = `<span class="level-card__nexticon">👑</span><span>Nível máximo<br>atingido!</span>`;
    }
  }
}

function firstUnwatchedIndex() {
  // primeira aula não concluída; se todas concluídas, volta pra primeira
  const i = ALL.findIndex(l => !getProg(l.yt).done);
  return i === -1 ? 0 : i;
}

function updateResume() {
  const last = load(LAST_KEY);
  let idx;
  if (last != null && ALL[last] && !getProg(ALL[last].yt).done) idx = last;
  else idx = firstUnwatchedIndex();
  const l = ALL[idx];
  const anyProgress = ALL.some(x => getProg(x.yt).pct > 0);
  document.getElementById('resumeLabel').textContent = anyProgress ? 'Continuar de onde parou' : 'Comece por aqui';
  document.getElementById('resumeTitle').textContent = l.title;
  document.getElementById('resumeSub').textContent = `${l.catTitle} · ${l.moduleTitle}`;
  document.getElementById('resumeBtnText').textContent = anyProgress ? 'Continuar' : 'Começar';
  document.getElementById('resumeBtn').onclick = () => openPlayer(idx);
  // imagem de fundo do hero (alta resolução, 1 imagem só)
  const bg = document.getElementById('resumeBg');
  if (bg) {
    const hi = `https://i.ytimg.com/vi/${l.yt}/maxresdefault.jpg`;
    const img = new Image();
    img.onload = () => { bg.style.backgroundImage = `url('${hi}')`; };
    img.onerror = () => { bg.style.backgroundImage = `url('https://i.ytimg.com/vi/${l.yt}/hqdefault.jpg')`; };
    img.src = hi;
  }
}

// ============ PLAYER ============
const playerEl = document.getElementById('player');
const playerMount = document.getElementById('playerMount');
let currentIdx = 0;

// YouTube IFrame API
let ytApiReady = false, ytPlayer = null, ytTimer = null;
const ytQueue = [];
(function loadYT() { const t = document.createElement('script'); t.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(t); })();
window.onYouTubeIframeAPIReady = () => { ytApiReady = true; while (ytQueue.length) ytQueue.shift()(); };

function mountPlayer(videoId) {
  clearInterval(ytTimer);
  if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch {} ytPlayer = null; }
  playerMount.innerHTML = '<div id="ytplayer"></div>';
  const create = () => {
    ytPlayer = new YT.Player('ytplayer', {
      videoId,
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: (e) => { try { e.target.playVideo(); } catch {} },
        onStateChange: onState,
      },
    });
  };
  if (ytApiReady) create(); else ytQueue.push(create);
}
function onState(e) {
  if (e.data === YT.PlayerState.PLAYING) { clearInterval(ytTimer); ytTimer = setInterval(track, 1000); }
  else { clearInterval(ytTimer); if (e.data === YT.PlayerState.ENDED) { const yt = ALL[currentIdx].yt; setProg(yt, 100, true); } }
}
function track() {
  if (!ytPlayer || !ytPlayer.getDuration) return;
  const dur = ytPlayer.getDuration(), cur = ytPlayer.getCurrentTime();
  if (!dur) return;
  const pct = Math.min(100, cur / dur * 100);
  setProg(ALL[currentIdx].yt, pct, pct >= 95);
}

function buildPlaylist(idx) {
  const l = ALL[idx];
  const cat = CATALOG[l.catIndex];
  const mod = cat.modules[l.moduleIndex];
  const rows = mod.lessons.map((ls, li) => {
    const gi = idxOf(ls.yt);
    const p = getProg(ls.yt);
    const active = gi === idx ? 'style="background:rgba(46,224,106,.08)"' : '';
    return `
      <div class="lesson ${p.done ? 'is-done' : ''}" data-yt="${ls.yt}" ${active}>
        <span class="lesson__num">${li + 1}</span>
        <div class="lesson__thumb"><img loading="lazy" src="${thumb(ls.yt)}" alt="" />
          <span class="lesson__play"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14l11-7z"/></svg></span></div>
        <div class="lesson__body"><div class="lesson__title">${escapeHtml(ls.title)}</div>
          <div class="lesson__state">${p.done ? 'Concluída' : (p.pct > 0 ? p.pct + '% assistido' : 'Não iniciada')}</div></div>
        <span class="lesson__check"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span>
      </div>`;
  }).join('');
  const pl = document.getElementById('playerPlaylist');
  pl.innerHTML = `<div class="ptitle">${escapeHtml(mod.title)}</div>${rows}`;
  pl.querySelectorAll('.lesson').forEach(r => r.addEventListener('click', () => openPlayer(idxOf(r.dataset.yt))));
}

function openPlayer(idx) {
  if (idx == null || idx < 0) return;
  currentIdx = idx;
  save(LAST_KEY, idx);
  const l = ALL[idx];
  document.getElementById('playerCrumb').textContent = `${l.catTitle} › ${l.moduleTitle}`;
  document.getElementById('playerTitle').textContent = l.title;
  const p = getProg(l.yt);
  document.getElementById('playerPct').textContent = (p.pct || 0) + '% assistido';
  const flag = document.getElementById('playerDoneFlag');
  flag.classList.toggle('show', !!p.done);
  const doneBtn = document.getElementById('markDone');
  doneBtn.classList.toggle('is-done', !!p.done);
  doneBtn.textContent = p.done ? '✓ Concluída' : '✓ Marcar como concluída';

  buildPlaylist(idx);
  playerEl.classList.add('open');
  playerEl.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  playerEl.scrollTop = 0;
  mountPlayer(l.yt);
  updateResume();
}
function closePlayer() {
  clearInterval(ytTimer);
  if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch {} ytPlayer = null; }
  playerEl.classList.remove('open');
  playerEl.setAttribute('aria-hidden', 'true');
  playerMount.innerHTML = '';
  document.body.style.overflow = '';
}

document.getElementById('playerBack').addEventListener('click', closePlayer);
document.getElementById('prevLesson').addEventListener('click', () => openPlayer((currentIdx - 1 + ALL.length) % ALL.length));
document.getElementById('nextLesson').addEventListener('click', () => openPlayer((currentIdx + 1) % ALL.length));
document.getElementById('markDone').addEventListener('click', () => {
  const yt = ALL[currentIdx].yt;
  setProg(yt, 100, true);
  // atualiza o player na hora
  document.getElementById('playerPct').textContent = '100% assistido';
  document.getElementById('playerDoneFlag').classList.add('show');
  const b = document.getElementById('markDone');
  b.classList.add('is-done'); b.textContent = '✓ Concluída';
  buildPlaylist(currentIdx);
});
document.addEventListener('keydown', (e) => {
  if (!playerEl.classList.contains('open')) return;
  if (e.key === 'Escape') closePlayer();
  if (e.key === 'ArrowRight') openPlayer((currentIdx + 1) % ALL.length);
  if (e.key === 'ArrowLeft') openPlayer((currentIdx - 1 + ALL.length) % ALL.length);
});

// ============ BUSCA ============
const searchbar = document.getElementById('searchbar');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
document.getElementById('searchToggle').addEventListener('click', () => {
  searchbar.classList.toggle('open');
  if (searchbar.classList.contains('open')) searchInput.focus();
  else { searchInput.value = ''; doSearch(); }
});
document.getElementById('searchClear').addEventListener('click', () => { searchInput.value = ''; doSearch(); searchInput.focus(); });
searchInput.addEventListener('input', doSearch);
function doSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { searchResults.classList.add('hidden'); catalogEl.classList.remove('hidden'); searchResults.innerHTML = ''; return; }
  catalogEl.classList.add('hidden');
  searchResults.classList.remove('hidden');
  const matches = ALL.filter(l => l.title.toLowerCase().includes(q) || l.catTitle.toLowerCase().includes(q) || l.moduleTitle.toLowerCase().includes(q));
  if (!matches.length) { searchResults.innerHTML = '<h3>Nenhuma aula encontrada.</h3>'; return; }
  searchResults.innerHTML = `<h3>${matches.length} resultado(s)</h3><div class="poster-grid">` +
    matches.map((l, i) => lessonRow(l, i + 1, { color: l.color, title: l.catTitle, id: l.catId })).join('') + '</div>';
  searchResults.querySelectorAll('.poster').forEach(r => r.addEventListener('click', () => openPlayer(idxOf(r.dataset.yt))));
}

document.getElementById('brandHome').addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

// ============ PROVA / QUIZ ============
const quizEl = document.getElementById('quiz');
let quizState = null; // { key, questions, order, current, answers }

function moduleTitleByKey(key) {
  const i = key.lastIndexOf('-');
  const catId = key.slice(0, i);
  const mi = Number(key.slice(i + 1));
  const cat = CATALOG.find(c => c.id === catId);
  if (!cat) return { cat: '', mod: 'Módulo' };
  return { cat: cat.title, mod: cat.modules[mi]?.title || 'Módulo' };
}

function openQuiz(key) {
  const quiz = QUIZZES[key];
  if (!quiz) return;
  const t = moduleTitleByKey(key);
  // Embaralha questões e alternativas para evitar decoreba de posição
  const shuffled = shuffleQuiz(quiz.questions);
  quizState = { key, questions: shuffled, current: 0, answers: [] };
  document.getElementById('quizModuleTitle').textContent = t.mod;
  document.getElementById('quizIntroSub').textContent = `${t.cat} · ${shuffled.length} questões`;
  showQuizScreen('quizIntro');
  quizEl.classList.add('open');
  quizEl.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

// Embaralha (Fisher-Yates) sem alterar o array original
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Retorna novas questões com ordem e alternativas embaralhadas,
// recalculando o índice da resposta correta.
function shuffleQuiz(questions) {
  return shuffleArray(questions).map(q => {
    const correctText = q.options[q.answer];
    const opts = shuffleArray(q.options);
    return { q: q.q, options: opts, answer: opts.indexOf(correctText) };
  });
}
function closeQuiz() {
  quizEl.classList.remove('open');
  quizEl.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  quizState = null;
}
function showQuizScreen(id) {
  ['quizIntro', 'quizQuestions', 'quizResult'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}
function renderQuestion() {
  const { questions, current } = quizState;
  const q = questions[current];
  document.getElementById('quizQCount').textContent = `Questão ${current + 1} de ${questions.length}`;
  document.getElementById('quizProgressBar').style.width = (current / questions.length * 100) + '%';
  document.getElementById('quizQText').textContent = q.q;
  const optsEl = document.getElementById('quizOptions');
  optsEl.innerHTML = q.options.map((opt, i) =>
    `<button class="quiz__opt" data-i="${i}">${escapeHtml(opt)}</button>`
  ).join('');
  optsEl.querySelectorAll('.quiz__opt').forEach(btn => {
    btn.addEventListener('click', () => answerQuestion(Number(btn.dataset.i), btn));
  });
}
function answerQuestion(choice, btnEl) {
  const { questions, current } = quizState;
  const q = questions[current];
  quizState.answers[current] = choice;
  const optsEl = document.getElementById('quizOptions');
  // bloqueia e mostra certo/errado
  optsEl.querySelectorAll('.quiz__opt').forEach((b, i) => {
    b.disabled = true;
    if (i === q.answer) b.classList.add('correct');
    else if (i === choice) b.classList.add('wrong');
  });
  setTimeout(() => {
    if (current + 1 < questions.length) {
      quizState.current++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }, 850);
}
function finishQuiz() {
  const { questions, answers, key } = quizState;
  let acertos = 0;
  questions.forEach((q, i) => { if (answers[i] === q.answer) acertos++; });
  const score = Math.round(acertos / questions.length * 100);
  const passed = score >= PASS_SCORE;
  const wasPassed = getExam(key)?.passed;
  setExam(key, score, passed);

  document.getElementById('quizProgressBar').style.width = '100%';
  showQuizScreen('quizResult');
  document.getElementById('quizResultIcon').textContent = passed ? '🎉' : '💪';
  document.getElementById('quizResultTitle').textContent = passed ? 'Aprovado!' : 'Quase lá!';
  const scoreEl = document.getElementById('quizScore');
  scoreEl.textContent = score + '%';
  scoreEl.className = 'quiz__score ' + (passed ? 'pass' : 'fail');
  document.getElementById('quizResultSub').textContent = passed
    ? `Você acertou ${acertos} de ${questions.length}. ${!wasPassed ? 'Selo de conhecimento liberado!' : 'Mandou bem de novo!'}`
    : `Você acertou ${acertos} de ${questions.length}. Precisa de ${PASS_SCORE}% para aprovar. Revise o módulo e tente de novo!`;

  // atualiza UI geral
  renderCatalog();
  updateStats();
  // reabre os módulos? mantém simples
}

document.getElementById('quizClose').addEventListener('click', closeQuiz);
document.getElementById('quizBackdrop').addEventListener('click', closeQuiz);
document.getElementById('quizStart').addEventListener('click', () => { showQuizScreen('quizQuestions'); renderQuestion(); });
document.getElementById('quizRetry').addEventListener('click', () => { quizState.questions = shuffleQuiz(quizState.questions); quizState.current = 0; quizState.answers = []; showQuizScreen('quizQuestions'); renderQuestion(); });
document.getElementById('quizDoneBtn').addEventListener('click', closeQuiz);

// ============ INIT ============
renderCatalog();
updateStats();
updateLevel();
updateResume();
// abre o primeiro módulo por padrão para já mostrar conteúdo
const firstMod = document.querySelector('.module');
if (firstMod) firstMod.classList.add('open');
