import * as store from './store.js';
import { searchRegions, POPULAR } from './regions.js';
import { geocodeRegion, hasMapKey } from './map.js';
import { esc, $, $$, toast, fmtDate, isoDate, parseDate, tripRangeLabel, dayCount, openSheet, closeAllSheets, ROLE_LABEL, avatar } from './ui.js';
import { renderTrip, leaveTripView } from './trip.js';

const app = document.getElementById('app');
export const session = { user: null, profile: null };
const PENDING_KEY = 'tp-pending-route';

// ---------------- 라우터 ----------------
function route() {
  closeAllSheets();
  leaveTripView();
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, arg] = hash.split('/');

  if (page === 'invite' && arg) return viewInvite(arg);
  if (!session.user) return viewLogin();
  if (page === 'new') return viewNewTrip();
  if (page === 'trip' && arg) return renderTrip(app, arg);
  if (page === 'settings') return viewSettings();
  return viewHome();
}
export const go = (path) => { if (location.hash === '#' + path) route(); else location.hash = path; };

// ---------------- 로그인 ----------------
function viewLogin(message) {
  app.innerHTML = `
    <main class="login">
      <div class="login-hero">
        <img src="icons/icon-192.png" alt="" class="login-logo">
        <h1>함께 떠나요</h1>
        <p>일행과 같이 짜는 국내 여행 플래너</p>
      </div>
      ${message ? `<p class="login-msg">${esc(message)}</p>` : ''}
      <div class="login-btns">
        <button class="btn kakao" data-p="kakao"><span class="kakao-bubble"></span>카카오로 시작하기</button>
        <button class="btn google" data-p="google"><span class="g-logo">G</span>Google로 시작하기</button>
      </div>
      ${installHint()}
    </main>`;
  $$('[data-p]', app).forEach((b) => (b.onclick = async () => {
    try { await store.signIn(b.dataset.p); } catch (e) { toast('로그인 실패: ' + e.message); }
  }));
}

function installHint() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (standalone || !ios) return '';
  return `<div class="install-hint">📲 Safari 아래쪽 <b>공유 버튼</b> → <b>홈 화면에 추가</b>를 누르면 앱처럼 쓸 수 있어요.<br><small>홈 화면 앱에서는 한 번 더 로그인해야 해요.</small></div>`;
}

// ---------------- 홈: 내 여행 ----------------
async function viewHome() {
  app.innerHTML = `
    <header class="topbar">
      <h1 class="brand">내 여행</h1>
      <button class="icon-btn" data-settings aria-label="설정">${avatar(session.profile, 30)}</button>
    </header>
    ${store.isDemo ? demoBanner() : ''}
    <main class="home"><div class="loading">불러오는 중…</div></main>
    <button class="fab" data-new>＋ 새 여행</button>`;
  $('[data-settings]', app).onclick = () => go('/settings');
  $('[data-new]', app).onclick = () => go('/new');
  const main = $('.home', app);
  try {
    const trips = await store.listTrips(session.user.id);
    if (!trips.length) {
      main.innerHTML = `<div class="empty"><div class="empty-emoji">🧳</div><p>아직 여행이 없어요.<br>첫 여행을 만들어볼까요?</p>
        <button class="btn primary" data-new2>새 여행 만들기</button></div>`;
      $('[data-new2]', main).onclick = () => go('/new');
      return;
    }
    const today = isoDate(new Date());
    const upcoming = trips.filter((t) => t.end_date >= today).sort((a, b) => (a.start_date > b.start_date ? 1 : -1));
    const past = trips.filter((t) => t.end_date < today);
    const card = (t) => {
      const dday = Math.round((parseDate(t.start_date) - parseDate(today)) / 864e5);
      const badge = t.end_date < today ? '' : dday > 0 ? `D-${dday}` : '여행 중';
      return `<a class="trip-card" href="#/trip/${t.id}">
        <div class="trip-card-top"><span class="trip-regions">${esc((t.regions || []).map((r) => r.name).join(' · ') || '국내')}</span>
        ${badge ? `<span class="dday">${badge}</span>` : ''}</div>
        <div class="trip-title">${esc(t.title)}</div>
        <div class="trip-sub">${tripRangeLabel(t)}${t.my_role !== 'owner' ? ` · <span class="role-chip ${t.my_role}">${ROLE_LABEL[t.my_role]}</span>` : ''}</div>
      </a>`;
    };
    main.innerHTML = `
      ${upcoming.length ? `<h2 class="section-title">다가오는 여행</h2>${upcoming.map(card).join('')}` : ''}
      ${past.length ? `<h2 class="section-title">지난 여행</h2>${past.map(card).join('')}` : ''}`;
  } catch (e) {
    main.innerHTML = `<p class="error">불러오지 못했어요: ${esc(e.message)}</p>`;
  }
}

export function demoBanner() {
  return `<div class="demo-banner">데모 모드 · 이 기기에만 저장돼요. 키를 넣으면 일행과 실시간 공유돼요.</div>`;
}

// ---------------- 새 여행 만들기 ----------------
function viewNewTrip() {
  const state = { step: 1, regions: [], start: null, end: null, title: '' };
  const render = () => {
    app.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-back aria-label="뒤로">‹</button>
        <h1>새 여행 <small class="step">${state.step}/3</small></h1>
        <span style="width:40px"></span>
      </header>
      <div class="progress"><span style="width:${state.step * 33.4}%"></span></div>
      <main class="wizard"></main>`;
    $('[data-back]', app).onclick = () => (state.step > 1 ? (state.step--, render()) : go('/'));
    const main = $('.wizard', app);
    if (state.step === 1) stepRegion(main, state, () => { state.step = 2; render(); });
    else if (state.step === 2) stepDates(main, state, () => { state.step = 3; render(); });
    else stepTitle(main, state);
  };
  render();
}

function stepRegion(main, state, next) {
  main.innerHTML = `
    <h2 class="q">어디로 떠나세요?</h2>
    <div class="search-box">
      <span>🔍</span><input type="search" placeholder="지역 검색 (예: 서, 부산, 강릉, ㅈㅈ)" autocomplete="off" enterkeyhint="search">
    </div>
    <div class="chips selected"></div>
    <ul class="region-list"></ul>
    <div class="bottom-bar"><button class="btn primary block" data-next disabled>다음</button></div>`;
  const input = $('input', main);
  const list = $('.region-list', main);
  const chips = $('.chips', main);
  const nextBtn = $('[data-next]', main);

  const has = (full) => state.regions.some((r) => r.full === full);
  const toggle = (r) => {
    if (has(r.full)) state.regions = state.regions.filter((x) => x.full !== r.full);
    else state.regions.push({ name: r.name, full: r.full });
    paint();
  };
  const paint = () => {
    chips.innerHTML = state.regions.map((r, i) => `<button class="chip on" data-i="${i}">${esc(r.name)} ✕</button>`).join('');
    $$('[data-i]', chips).forEach((b) => (b.onclick = () => { state.regions.splice(+b.dataset.i, 1); paint(); }));
    nextBtn.disabled = !state.regions.length;
    const q = input.value.trim();
    const rows = q ? searchRegions(q) : POPULAR;
    list.innerHTML = (q ? '' : '<li class="list-label">인기 여행지</li>') + rows.map((r) => `
      <li><button class="region-row ${has(r.full) ? 'on' : ''}" data-full="${esc(r.full)}">
        <span class="region-name">${highlight(r.name, q)}</span>
        <span class="region-parent">${esc(r.parent || '시·도 전체')}</span>
        <span class="check">${has(r.full) ? '✓' : ''}</span>
      </button></li>`).join('')
      + (q && !rows.some((r) => r.name === q) ? `<li><button class="region-row custom" data-custom>
        <span class="region-name">'${esc(q)}' 직접 입력</span><span class="region-parent">목록에 없는 곳</span></button></li>` : '');
    $$('[data-full]', list).forEach((b) => (b.onclick = () => {
      const r = [...rows].find((x) => x.full === b.dataset.full);
      toggle(r);
    }));
    const custom = $('[data-custom]', list);
    if (custom) custom.onclick = () => { toggle({ name: q, full: q }); input.value = ''; paint(); };
  };
  input.oninput = paint;
  nextBtn.onclick = next;
  paint();
  setTimeout(() => input.focus(), 50);
}

function highlight(name, q) {
  if (!q || !name.startsWith(q)) return esc(name);
  return `<b>${esc(q)}</b>${esc(name.slice(q.length))}`;
}

function stepDates(main, state, next) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let cursor = state.start ? parseDate(state.start) : new Date(today.getFullYear(), today.getMonth(), 1);
  cursor.setDate(1);
  const render = () => {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const iso = isoDate(new Date(y, m, d));
      const cls = ['day'];
      if (iso === isoDate(today)) cls.push('today');
      if (state.start && iso === state.start) cls.push('start');
      if (state.end && iso === state.end) cls.push('end');
      if (state.start && state.end && iso > state.start && iso < state.end) cls.push('mid');
      const dow = (first + d - 1) % 7;
      if (dow === 0) cls.push('sun'); if (dow === 6) cls.push('sat');
      cells += `<button class="${cls.join(' ')}" data-d="${iso}">${d}</button>`;
    }
    const summary = state.start
      ? state.end ? tripRangeLabel({ start_date: state.start, end_date: state.end }) : `${fmtDate(state.start)} 출발 · 도착일을 골라주세요`
      : '출발일을 골라주세요';
    main.innerHTML = `
      <h2 class="q">언제 떠나세요?</h2>
      <p class="range-summary">${summary}</p>
      <div class="cal">
        <div class="cal-head"><button class="icon-btn" data-prev>‹</button><b>${y}년 ${m + 1}월</b><button class="icon-btn" data-nextm>›</button></div>
        <div class="cal-week"><span class="sun">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span class="sat">토</span></div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="bottom-bar"><button class="btn primary block" data-next ${state.start ? '' : 'disabled'}>${state.start && !state.end ? '당일치기로 다음' : '다음'}</button></div>`;
    $('[data-prev]', main).onclick = () => { cursor.setMonth(cursor.getMonth() - 1); render(); };
    $('[data-nextm]', main).onclick = () => { cursor.setMonth(cursor.getMonth() + 1); render(); };
    $$('[data-d]', main).forEach((b) => (b.onclick = () => {
      const d = b.dataset.d;
      if (!state.start || state.end || d < state.start) { state.start = d; state.end = null; }
      else state.end = d === state.start ? null : d;
      if (state.end && dayCount(state.start, state.end) > 30) { toast('여행은 최대 30일까지 만들 수 있어요'); state.end = null; }
      render();
    }));
    $('[data-next]', main).onclick = () => { if (!state.end) state.end = state.start; next(); };
  };
  render();
}

function stepTitle(main, state) {
  const def = `${state.regions.map((r) => (r.name.length > 2 ? r.name.replace(/(특별자치도|특별자치시|특별시|광역시|시|군)$/, '') : r.name)).join('·')} 여행`;
  main.innerHTML = `
    <h2 class="q">여행 이름을 정해주세요</h2>
    <input class="input big" maxlength="40" value="${esc(state.title || def)}">
    <div class="summary-card">
      <div>📍 ${esc(state.regions.map((r) => r.full).join(', '))}</div>
      <div>🗓️ ${tripRangeLabel({ start_date: state.start, end_date: state.end })}</div>
    </div>
    <div class="bottom-bar"><button class="btn primary block" data-create>여행 만들기</button></div>`;
  const input = $('input', main);
  $('[data-create]', main).onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '만드는 중…';
    try {
      const regions = await Promise.all(state.regions.map(async (r) => ({ ...r, ...(hasMapKey() ? await geocodeRegion(r.full) : {}) })));
      const trip = await store.createTrip(session.user.id, {
        title: input.value.trim() || def, regions, start_date: state.start, end_date: state.end,
      });
      go('/trip/' + trip.id);
    } catch (err) {
      toast('만들지 못했어요: ' + err.message);
      e.target.disabled = false; e.target.textContent = '여행 만들기';
    }
  };
}

// ---------------- 초대 수락 ----------------
async function viewInvite(token) {
  if (!session.user) {
    try { localStorage.setItem(PENDING_KEY, '/invite/' + token); } catch {}
    return viewLogin('여행에 초대받았어요! 로그인하면 바로 참여할 수 있어요.');
  }
  app.innerHTML = `<main class="invite"><div class="loading">초대 정보를 확인하는 중…</div></main>`;
  const main = $('.invite', app);
  try {
    const inv = await store.getInvite(token);
    if (!inv) { main.innerHTML = `<div class="empty"><div class="empty-emoji">🤔</div><p>존재하지 않는 초대 링크예요.</p><a class="btn" href="#/">홈으로</a></div>`; return; }
    if (inv.already_member && !store.isDemo) { go('/trip/' + inv.trip_id); return; }
    main.innerHTML = `
      <div class="invite-card">
        <div class="empty-emoji">✈️</div>
        <p><b>${esc(inv.inviter || '일행')}</b>님이 여행에 초대했어요</p>
        <h2>${esc(inv.title)}</h2>
        <p class="trip-sub">${tripRangeLabel(inv)}</p>
        <p><span class="role-chip ${inv.role}">${ROLE_LABEL[inv.role]}</span></p>
        ${inv.valid ? `<button class="btn primary block" data-accept>참여하기</button>` : `<p class="error">만료되었거나 취소된 초대예요. 다시 요청해 주세요.</p>`}
        <a class="btn ghost block" href="#/">나중에</a>
      </div>
      ${installHint()}`;
    const btn = $('[data-accept]', main);
    if (btn) btn.onclick = async () => {
      btn.disabled = true;
      try { const id = await store.acceptInvite(token); toast('여행에 참여했어요!'); go('/trip/' + id); }
      catch (e) { toast(e.message); btn.disabled = false; }
    };
  } catch (e) {
    main.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// ---------------- 설정 ----------------
function viewSettings() {
  app.innerHTML = `
    <header class="topbar"><button class="icon-btn" data-back>‹</button><h1>설정</h1><span style="width:40px"></span></header>
    <main class="settings">
      <div class="profile-row">${avatar(session.profile, 56)}<div><div class="muted">${esc(session.user.email || '')}</div></div></div>
      <label class="field"><span>닉네임 (일행에게 보이는 이름)</span>
        <input class="input" maxlength="20" value="${esc(session.profile?.nickname || '')}"></label>
      <button class="btn primary block" data-save>저장</button>
      ${store.isDemo ? '' : '<button class="btn ghost block" data-logout>로그아웃</button>'}
      <p class="muted small">버전 1.0 · ${store.isDemo ? '데모 모드' : '온라인 모드'}</p>
    </main>`;
  $('[data-back]', app).onclick = () => go('/');
  $('[data-save]', app).onclick = async () => {
    const v = $('input', app).value.trim();
    if (!v) return toast('닉네임을 입력하세요');
    await store.updateNickname(session.user.id, v);
    session.profile = { ...session.profile, nickname: v };
    toast('저장했어요');
  };
  const lo = $('[data-logout]', app);
  if (lo) lo.onclick = async () => { await store.signOut(); session.user = null; go('/'); };
}

// ---------------- 시작 ----------------
async function boot() {
  try {
    await store.initStore();
  } catch (e) {
    app.innerHTML = `<p class="error">서버에 연결하지 못했어요: ${esc(e.message)}</p>`;
    return;
  }
  session.user = await store.getUser();
  if (session.user) session.profile = await store.getProfile(session.user.id).catch(() => null);

  // 로그인 전에 열었던 초대 링크로 복귀
  let pending = null;
  try { pending = localStorage.getItem(PENDING_KEY); } catch {}
  if (session.user && pending) {
    try { localStorage.removeItem(PENDING_KEY); } catch {}
    location.hash = pending;
  }

  store.onAuthChange(async (ev) => {
    const u = await store.getUser();
    if ((u?.id || null) === (session.user?.id || null)) return;
    session.user = u;
    session.profile = u ? await store.getProfile(u.id).catch(() => null) : null;
    route();
  });
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
