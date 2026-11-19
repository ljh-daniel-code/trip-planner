// 여행 상세 화면: 상단 항목(일행/준비물/메모/가계부/기록) + 지도 + 일정
import * as store from './store.js';
import { session, go, demoBanner } from './app.js';
import { TripMap, hasMapKey, searchPlaces, DAY_COLORS, kakaoMapLink } from './map.js';
import {
  esc, $, $$, toast, won, fmtDate, addDays, isoDate, dayCount, tripRangeLabel, timeAgo,
  openSheet, openSheets, confirmBox, avatar, ROLE_LABEL,
} from './ui.js';

let S = null; // 현재 화면 상태

export function leaveTripView() {
  if (S) { S.unsub?.(); S = null; }
}

const canEdit = () => S && (S.data.role === 'owner' || S.data.role === 'editor');
const nameOf = (uid) => S.data.members.find((m) => m.user_id === uid)?.nickname || '이전 일행';
const days = () => dayCount(S.data.trip.start_date, S.data.trip.end_date);
const itemsOfDay = (d) => S.data.items.filter((i) => Math.min(i.day_index, days() - 1) === d)
  .sort((a, b) => a.position - b.position || (a.created_at < b.created_at ? -1 : 1));
const regionCenter = () => (S.data.trip.regions || []).find((r) => r.lat);

export async function renderTrip(app, tripId) {
  S = { tripId, day: 0, map: null, unsub: null, data: null };
  app.innerHTML = `<div class="loading full">불러오는 중…</div>`;
  const ok = await reload();
  if (!ok) {
    app.innerHTML = `<div class="empty"><div class="empty-emoji">🔒</div><p>이 여행을 볼 수 없어요.<br>삭제되었거나 일행에서 빠졌을 수 있어요.</p><a class="btn" href="#/">홈으로</a></div>`;
    return;
  }
  const today = isoDate(new Date());
  const t = S.data.trip;
  if (today >= t.start_date && today <= t.end_date) S.day = dayCount(t.start_date, today) - 1;

  app.innerHTML = `
    <div class="trip-screen">
      <header class="topbar trip-top">
        <button class="icon-btn" data-back aria-label="뒤로">‹</button>
        <button class="trip-head" data-info><b class="t-title"></b><small class="t-range"></small></button>
        <button class="icon-btn" data-info2 aria-label="여행 정보">⋯</button>
      </header>
      ${store.isDemo ? demoBanner() : ''}
      <nav class="trip-tabs">
        <button data-panel="members">👥 <span>일행</span><em class="cnt-members"></em></button>
        <button data-panel="checklist">🎒 <span>준비물</span><em class="cnt-check"></em></button>
        <button data-panel="notes">📝 <span>메모</span></button>
        <button data-panel="budget">💰 <span>가계부</span></button>
        <button data-panel="logs">🕘 <span>기록</span></button>
      </nav>
      <div class="map-wrap"><div id="map"></div></div>
      <section class="plan">
        <div class="day-tabs"></div>
        <div class="plan-list"></div>
      </section>
    </div>`;
  $('[data-back]', app).onclick = () => go('/');
  $('[data-info]', app).onclick = openTripInfo;
  $('[data-info2]', app).onclick = openTripInfo;
  $$('[data-panel]', app).forEach((b) => (b.onclick = () => PANELS[b.dataset.panel]()));

  paint();
  initMap();
  S.unsub = store.subscribeTrip(tripId, async () => {
    if (!S) return;
    const ok2 = await reload();
    if (!ok2) { toast('이 여행에 더 이상 접근할 수 없어요'); go('/'); return; }
    paint();
    openSheets().forEach((s) => { if (!s.body.contains(document.activeElement) || document.activeElement === document.body) s.rerender(); });
  });
}

async function reload() {
  try {
    const data = await store.loadTrip(S.tripId, session.user.id);
    if (!data || !S) return false;
    S.data = data;
    return true;
  } catch (e) {
    toast('불러오기 실패: ' + e.message);
    return !!S?.data;
  }
}

// 로컬 변경 후 즉시 반영 (실시간 이벤트를 기다리지 않음)
async function refresh() {
  if (!S) return;
  await reload();
  paint();
  openSheets().forEach((s) => s.rerender());
}

function paint() {
  if (!S || !document.querySelector('.trip-screen')) return;
  const t = S.data.trip;
  $('.t-title').textContent = t.title;
  $('.t-range').textContent = tripRangeLabel(t) + (canEdit() ? '' : ' · 보기 전용');
  $('.cnt-members').textContent = S.data.members.length;
  const ch = S.data.checklist;
  $('.cnt-check').textContent = ch.length ? `${ch.filter((c) => c.checked).length}/${ch.length}` : '';
  if (S.day !== 'all' && S.day >= days()) S.day = days() - 1;
  paintDayTabs();
  paintPlan();
  paintMap();
}

function paintDayTabs() {
  const n = days();
  const el = $('.day-tabs');
  let html = `<button class="day-tab ${S.day === 'all' ? 'on' : ''}" data-day="all">전체</button>`;
  for (let d = 0; d < n; d++) {
    html += `<button class="day-tab ${S.day === d ? 'on' : ''}" data-day="${d}" style="--c:${DAY_COLORS[d % DAY_COLORS.length]}">
      <b>${d + 1}일차</b><small>${fmtDate(addDays(S.data.trip.start_date, d))}</small></button>`;
  }
  el.innerHTML = html;
  $$('[data-day]', el).forEach((b) => (b.onclick = () => {
    S.day = b.dataset.day === 'all' ? 'all' : +b.dataset.day;
    paintDayTabs(); paintPlan(); paintMap();
  }));
  $('.day-tab.on', el)?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function paintPlan() {
  const el = $('.plan-list');
  const dayList = S.day === 'all' ? [...Array(days()).keys()] : [S.day];
  el.innerHTML = dayList.map((d) => {
    const items = itemsOfDay(d);
    const color = DAY_COLORS[d % DAY_COLORS.length];
    return `
      <div class="day-block">
        ${S.day === 'all' ? `<h3 class="day-title" style="color:${color}">${d + 1}일차 · ${fmtDate(addDays(S.data.trip.start_date, d))}</h3>` : ''}
        ${items.length ? '' : `<p class="muted empty-day">${canEdit() ? '아직 일정이 없어요. 아래 버튼으로 추가해 보세요.' : '아직 일정이 없어요.'}</p>`}
        <ol class="items">${items.map((it, idx) => itemRow(it, idx, items.length, color)).join('')}</ol>
        ${canEdit() ? `<button class="btn add-item" data-add="${d}">＋ ${d + 1}일차 일정 추가</button>` : ''}
      </div>`;
  }).join('');
  $$('[data-add]', el).forEach((b) => (b.onclick = () => openItemEditor(null, +b.dataset.add)));
  $$('.item', el).forEach((row) => {
    const it = S.data.items.find((x) => x.id === row.dataset.id);
    row.querySelector('.item-main').onclick = () => {
      if (it.lat && S.map) { S.map.focus(it.lat, it.lng); $('.map-wrap').scrollIntoView({ behavior: 'smooth' }); }
      else if (canEdit()) openItemEditor(it);
    };
    const edit = row.querySelector('[data-edit]');
    if (edit) edit.onclick = () => openItemEditor(it);
    const up = row.querySelector('[data-up]');
    const down = row.querySelector('[data-down]');
    if (up) up.onclick = () => move(it, -1);
    if (down) down.onclick = () => move(it, 1);
  });
}

function itemRow(it, idx, total, color) {
  const link = kakaoMapLink(it);
  return `
    <li class="item" data-id="${it.id}">
      <span class="num" style="background:${it.lat ? color : '#b8bfcc'}">${idx + 1}</span>
      <div class="item-main">
        <div class="item-title">${it.time ? `<span class="time">${esc(it.time)}</span>` : ''}${esc(it.title)}</div>
        ${it.address ? `<div class="item-addr">${esc(it.address)}</div>` : ''}
        ${it.memo ? `<div class="item-memo">${esc(it.memo)}</div>` : ''}
      </div>
      <div class="item-actions">
        ${link ? `<a class="mini-btn" href="${link}" target="_blank" rel="noopener" aria-label="카카오맵에서 보기">↗</a>` : ''}
        ${canEdit() ? `
          <button class="mini-btn" data-up ${idx === 0 ? 'disabled' : ''} aria-label="위로">▲</button>
          <button class="mini-btn" data-down ${idx === total - 1 ? 'disabled' : ''} aria-label="아래로">▼</button>
          <button class="mini-btn" data-edit aria-label="수정">✎</button>` : ''}
      </div>
    </li>`;
}

async function move(it, dir) {
  const list = itemsOfDay(Math.min(it.day_index, days() - 1));
  const i = list.findIndex((x) => x.id === it.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const rows = list.map((x, k) => ({ id: x.id, position: k }));
  rows.forEach((r) => { const x = S.data.items.find((y) => y.id === r.id); x.position = r.position; });
  paintPlan(); paintMap();
  try { await store.reorder('itinerary_items', rows); } catch (e) { toast('순서 저장 실패: ' + e.message); refresh(); }
}

// ---------------- 지도 ----------------
async function initMap() {
  const el = $('#map');
  if (!hasMapKey()) {
    el.innerHTML = `<div class="map-placeholder">🗺️<p>카카오 지도 키를 설정하면<br>여기에 지도와 동선이 표시돼요.</p><small>js/config.js → KAKAO_JS_KEY</small></div>`;
    return;
  }
  try {
    const map = await new TripMap(el).init(regionCenter());
    if (!S) return;
    S.map = map;
    paintMap();
  } catch (e) {
    el.innerHTML = `<div class="map-placeholder">⚠️<p>${esc(e.message)}</p></div>`;
  }
}

function paintMap() {
  if (!S?.map) return;
  const dayList = S.day === 'all' ? [...Array(days()).keys()] : [S.day];
  const groups = dayList.map((d) => ({
    color: DAY_COLORS[d % DAY_COLORS.length],
    points: itemsOfDay(d).map((it, idx) => ({ n: idx + 1, id: it.id, title: it.title, lat: it.lat, lng: it.lng }))
      .filter((p) => p.lat),
  }));
  S.map.draw(groups, (id) => {
    const row = document.querySelector(`.item[data-id="${id}"]`);
    if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); }
  }, regionCenter());
}

// ---------------- 일정 추가/수정 ----------------
function openItemEditor(item, dayIndex) {
  const isNew = !item;
  const f = item ? { ...item } : { day_index: dayIndex, title: '', time: '', memo: '', place_name: null, address: null, lat: null, lng: null, kakao_place_id: null };
  let results = [];
  let searching = false;
  const sheet = openSheet({
    title: isNew ? `${f.day_index + 1}일차 일정 추가` : '일정 수정',
    full: true,
    render(body, close) {
      if (body.dataset.ready) return; // 입력 중 덮어쓰지 않도록 최초 1회만 그림
      body.dataset.ready = '1';
      body.innerHTML = `
        ${hasMapKey() ? `
        <div class="search-box"><span>🔍</span><input type="search" data-q placeholder="장소 검색 (예: 해운대 맛집, 경복궁)" enterkeyhint="search"></div>
        <ul class="place-results"></ul>` : `<p class="muted small">카카오 키를 설정하면 장소를 검색해 지도에 표시할 수 있어요.</p>`}
        <div class="picked"></div>
        <label class="field"><span>일정 이름</span><input class="input" data-title maxlength="60" placeholder="예: 점심 – 밀면" value="${esc(f.title)}"></label>
        <div class="row gap">
          <label class="field grow"><span>날짜</span><select class="input" data-day>${[...Array(days()).keys()].map((d) =>
            `<option value="${d}" ${d === Math.min(f.day_index, days() - 1) ? 'selected' : ''}>${d + 1}일차 · ${fmtDate(addDays(S.data.trip.start_date, d))}</option>`).join('')}</select></label>
          <label class="field"><span>시간</span><input class="input" type="time" data-time value="${esc(f.time || '')}"></label>
        </div>
        <label class="field"><span>메모</span><textarea class="input" data-memo rows="3" placeholder="예약번호, 가격, 팁 등">${esc(f.memo || '')}</textarea></label>
        <div class="row gap sheet-actions">
          ${isNew ? '' : '<button class="btn danger ghost" data-del>삭제</button>'}
          <button class="btn primary grow" data-save>${isNew ? '추가' : '저장'}</button>
        </div>`;
      const q = $('[data-q]', body);
      const resEl = $('.place-results', body);
      const titleEl = $('[data-title]', body);
      const paintPicked = () => {
        $('.picked', body).innerHTML = f.lat ? `<div class="picked-card">📍 <div><b>${esc(f.place_name)}</b><small>${esc(f.address || '')}</small></div>
          <button class="mini-btn" data-unpick aria-label="장소 빼기">✕</button></div>` : '';
        const un = $('[data-unpick]', body);
        if (un) un.onclick = () => { Object.assign(f, { place_name: null, address: null, lat: null, lng: null, kakao_place_id: null }); paintPicked(); };
      };
      const paintResults = () => {
        if (!resEl) return;
        resEl.innerHTML = searching ? '<li class="muted">검색 중…</li>' : results.map((p, i) => `
          <li><button class="place-row" data-i="${i}"><b>${esc(p.name)}</b><small>${esc(p.category)} · ${esc(p.address)}</small></button></li>`).join('');
        $$('[data-i]', resEl).forEach((b) => (b.onclick = () => {
          const p = results[+b.dataset.i];
          Object.assign(f, { place_name: p.name, address: p.address, lat: p.lat, lng: p.lng, kakao_place_id: p.id });
          if (!titleEl.value.trim() || titleEl.dataset.auto) { titleEl.value = p.name; titleEl.dataset.auto = '1'; }
          results = []; q.value = ''; paintResults(); paintPicked();
        }));
      };
      if (q) {
        let timer;
        q.oninput = () => {
          clearTimeout(timer);
          const v = q.value.trim();
          if (!v) { results = []; paintResults(); return; }
          timer = setTimeout(async () => {
            searching = true; paintResults();
            const near = itemsOfDay(+$('[data-day]', body).value).filter((i) => i.lat).pop() || regionCenter();
            results = await searchPlaces(v, near).catch(() => []);
            searching = false; paintResults();
          }, 300);
        };
        if (isNew) setTimeout(() => q.focus(), 300);
      }
      titleEl.oninput = () => delete titleEl.dataset.auto;
      paintPicked();

      $('[data-save]', body).onclick = async (e) => {
        const title = titleEl.value.trim() || f.place_name;
        if (!title) return toast('일정 이름을 입력하거나 장소를 골라주세요');
        const day_index = +$('[data-day]', body).value;
        const row = {
          title, day_index, time: $('[data-time]', body).value || null, memo: $('[data-memo]', body).value.trim() || null,
          place_name: f.place_name, address: f.address, lat: f.lat, lng: f.lng, kakao_place_id: f.kakao_place_id,
        };
        e.target.disabled = true;
        try {
          if (isNew || day_index !== item.day_index) row.position = itemsOfDay(day_index).length;
          if (isNew) await store.insertRow('itinerary_items', { trip_id: S.tripId, ...row });
          else await store.updateRow('itinerary_items', item.id, row);
          close();
          if (S.day !== 'all') S.day = day_index;
          await refresh();
        } catch (err) { toast('저장 실패: ' + err.message); e.target.disabled = false; }
      };
      const del = $('[data-del]', body);
      if (del) del.onclick = async () => {
        if (!(await confirmBox(`'${item.title}' 일정을 삭제할까요?`, '삭제', true))) return;
        try { await store.deleteRow('itinerary_items', item.id); close(); refresh(); } catch (err) { toast(err.message); }
      };
    },
  });
  return sheet;
}

// ---------------- 여행 정보 ----------------
function openTripInfo() {
  const t = S.data.trip;
  const owner = S.data.role === 'owner';
  openSheet({
    title: '여행 정보',
    render(body, close) {
      if (body.dataset.ready) return;
      body.dataset.ready = '1';
      body.innerHTML = `
        <label class="field"><span>여행 이름</span><input class="input" data-title maxlength="40" value="${esc(t.title)}" ${canEdit() ? '' : 'disabled'}></label>
        <div class="row gap">
          <label class="field grow"><span>출발일</span><input class="input" type="date" data-start value="${t.start_date}" ${canEdit() ? '' : 'disabled'}></label>
          <label class="field grow"><span>도착일</span><input class="input" type="date" data-end value="${t.end_date}" ${canEdit() ? '' : 'disabled'}></label>
        </div>
        <p class="muted small">📍 ${esc((t.regions || []).map((r) => r.full).join(', '))}</p>
        ${canEdit() ? '<button class="btn primary block" data-save>저장</button>' : ''}
        <hr>
        ${owner ? '<button class="btn danger ghost block" data-delete>여행 삭제</button>' : '<button class="btn danger ghost block" data-leave>이 여행에서 나가기</button>'}`;
      const save = $('[data-save]', body);
      if (save) save.onclick = async () => {
        const start = $('[data-start]', body).value, end = $('[data-end]', body).value;
        if (!start || !end || end < start) return toast('날짜를 확인해 주세요');
        if (dayCount(start, end) > 30) return toast('여행은 최대 30일까지 가능해요');
        const n = dayCount(start, end);
        const over = S.data.items.filter((i) => i.day_index >= n);
        if (over.length && !(await confirmBox(`기간이 줄어서 일정 ${over.length}개가 마지막 날(${n}일차)로 옮겨져요. 계속할까요?`))) return;
        try {
          await store.updateTrip(S.tripId, { title: $('[data-title]', body).value.trim() || t.title, start_date: start, end_date: end });
          for (const it of over) await store.updateRow('itinerary_items', it.id, { day_index: n - 1 });
          close(); toast('저장했어요'); refresh();
        } catch (e) { toast(e.message); }
      };
      const delBtn = $('[data-delete]', body);
      if (delBtn) delBtn.onclick = async () => {
        if (!(await confirmBox('여행과 모든 일정·가계부·기록이 삭제되고 되돌릴 수 없어요. 삭제할까요?', '삭제', true))) return;
        try { await store.deleteTrip(S.tripId); close(); go('/'); } catch (e) { toast(e.message); }
      };
      const leave = $('[data-leave]', body);
      if (leave) leave.onclick = async () => {
        if (!(await confirmBox('이 여행에서 나갈까요? 다시 들어오려면 초대를 받아야 해요.', '나가기', true))) return;
        try { await store.removeMember(S.tripId, session.user.id); close(); go('/'); } catch (e) { toast(e.message); }
      };
    },
  });
}

// ================= 상단 항목 패널 =================
const PANELS = {
  members: () => openSheet({ title: '일행', render: renderMembers }),
  checklist: () => openSheet({ title: '준비물', render: renderChecklist }),
  notes: () => openSheet({ title: '메모', full: true, render: renderNotes }),
  budget: () => openSheet({ title: '가계부', full: true, render: renderBudget }),
  logs: () => openSheet({ title: '수정 기록', full: true, render: renderLogs }),
};

// ---------- 일행 ----------
async function renderMembers(body) {
  const owner = S.data.role === 'owner';
  const roleOrder = { owner: 0, editor: 1, viewer: 2 };
  const members = [...S.data.members].sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);
  body.innerHTML = `
    <ul class="member-list">${members.map((m) => `
      <li class="member">
        ${avatar(m, 40)}
        <div class="grow"><b>${esc(m.nickname)}</b>${m.user_id === session.user.id ? ' <small class="muted">(나)</small>' : ''}</div>
        ${owner && m.role !== 'owner' ? `
          <select class="input slim" data-role="${m.user_id}">
            <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>편집 가능</option>
            <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>보기만</option>
          </select>
          <button class="mini-btn" data-kick="${m.user_id}" aria-label="내보내기">✕</button>`
        : `<span class="role-chip ${m.role}">${ROLE_LABEL[m.role]}</span>`}
      </li>`).join('')}
    </ul>
    ${canEdit() ? `
      <h3 class="sub-title">일행 초대하기</h3>
      <p class="muted small">링크를 만들어 카톡 등으로 보내면, 받은 사람이 로그인 후 바로 참여해요. (14일 동안 유효)</p>
      <div class="row gap">
        <button class="btn primary grow" data-invite="editor">✏️ 같이 수정하기</button>
        <button class="btn grow" data-invite="viewer">👀 보기만 하기</button>
      </div>
      <div class="invite-list"></div>
      ${store.isDemo ? `<button class="btn ghost block small-btn" data-fake>＋ (데모) 가상 일행 추가</button>` : ''}` : ''}`;

  $$('[data-role]', body).forEach((s) => (s.onchange = async () => {
    try { await store.setMemberRole(S.tripId, s.dataset.role, s.value); toast('권한을 바꿨어요'); refresh(); } catch (e) { toast(e.message); }
  }));
  $$('[data-kick]', body).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox(`${nameOf(b.dataset.kick)}님을 일행에서 내보낼까요?`, '내보내기', true))) return;
    try { await store.removeMember(S.tripId, b.dataset.kick); refresh(); } catch (e) { toast(e.message); }
  }));
  $$('[data-invite]', body).forEach((b) => (b.onclick = async () => {
    try {
      const inv = await store.createInvite(S.tripId, b.dataset.invite);
      await shareInvite(inv);
      renderInvites(body);
    } catch (e) { toast('초대 링크를 만들지 못했어요: ' + e.message); }
  }));
  const fake = $('[data-fake]', body);
  if (fake) fake.onclick = () => {
    const names = ['민지', '서준', '하은', '도윤', '지우', '예준'];
    const used = S.data.members.map((m) => m.nickname);
    const name = names.find((n) => !used.includes(n)) || '친구' + S.data.members.length;
    store.demoAddFakeMember(S.tripId, name, 'editor');
    refresh();
  };
  if (canEdit()) renderInvites(body);
}

const inviteUrl = (inv) => `${location.origin}${location.pathname}#/invite/${inv.token}`;

async function shareInvite(inv) {
  const url = inviteUrl(inv);
  const text = `'${S.data.trip.title}' 여행에 초대합니다! (${inv.role === 'editor' ? '같이 수정 가능' : '보기 전용'})`;
  if (navigator.share) {
    try { await navigator.share({ title: S.data.trip.title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  await copy(url);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('초대 링크를 복사했어요. 카톡에 붙여넣기 하세요!'); }
  catch { prompt('아래 링크를 복사하세요', text); }
}

async function renderInvites(body) {
  const el = $('.invite-list', body);
  if (!el) return;
  try {
    const list = await store.listInvites(S.tripId);
    el.innerHTML = list.length ? `<h4 class="muted small">유효한 초대 링크</h4>` + list.map((i) => `
      <div class="invite-row">
        <span class="role-chip ${i.role}">${ROLE_LABEL[i.role]}</span>
        <small class="grow muted">${fmtDate(i.expires_at.slice(0, 10), false)}까지</small>
        <button class="mini-btn" data-copy="${i.id}">복사</button>
        <button class="mini-btn" data-revoke="${i.id}">취소</button>
      </div>`).join('') : '';
    $$('[data-copy]', el).forEach((b) => (b.onclick = () => copy(inviteUrl(list.find((i) => i.id === b.dataset.copy)))));
    $$('[data-revoke]', el).forEach((b) => (b.onclick = async () => {
      await store.revokeInvite(b.dataset.revoke); toast('초대 링크를 취소했어요'); renderInvites(body);
    }));
  } catch { el.innerHTML = ''; }
}

// ---------- 준비물 ----------
const SUGGEST = ['신분증', '충전기', '보조배터리', '세면도구', '상비약', '우산', '선크림', '여벌 옷', '카메라', '현금'];

function renderChecklist(body) {
  const list = [...S.data.checklist].sort((a, b) => a.checked - b.checked || (a.created_at < b.created_at ? -1 : 1));
  const done = list.filter((c) => c.checked).length;
  const existing = new Set(list.map((c) => c.text));
  body.innerHTML = `
    ${list.length ? `<div class="progress-line"><span style="width:${(done / list.length) * 100}%"></span></div>
      <p class="muted small">${done} / ${list.length} 챙김</p>` : ''}
    ${canEdit() ? `<form class="row gap add-row"><input class="input grow" placeholder="준비물 추가" maxlength="60"><button class="btn primary">추가</button></form>
      <div class="chips">${SUGGEST.filter((s) => !existing.has(s)).map((s) => `<button class="chip" data-sug="${esc(s)}">＋ ${esc(s)}</button>`).join('')}</div>` : ''}
    <ul class="check-list">${list.map((c) => `
      <li class="${c.checked ? 'done' : ''}">
        <label><input type="checkbox" data-chk="${c.id}" ${c.checked ? 'checked' : ''} ${canEdit() ? '' : 'disabled'}><span>${esc(c.text)}</span></label>
        ${canEdit() ? `<button class="mini-btn" data-del="${c.id}" aria-label="삭제">✕</button>` : ''}
      </li>`).join('')}</ul>
    ${list.length ? '' : '<p class="muted center">아직 준비물이 없어요.</p>'}`;
  const add = async (text) => {
    if (!text) return;
    try { await store.insertRow('checklist_items', { trip_id: S.tripId, text }); refresh(); } catch (e) { toast(e.message); }
  };
  const form = $('form', body);
  if (form) form.onsubmit = (e) => { e.preventDefault(); const i = $('input', form); add(i.value.trim()); i.value = ''; i.focus(); };
  $$('[data-sug]', body).forEach((b) => (b.onclick = () => add(b.dataset.sug)));
  $$('[data-chk]', body).forEach((c) => (c.onchange = async () => {
    try { await store.updateRow('checklist_items', c.dataset.chk, { checked: c.checked }); refresh(); } catch (e) { toast(e.message); }
  }));
  $$('[data-del]', body).forEach((b) => (b.onclick = async () => {
    try { await store.deleteRow('checklist_items', b.dataset.del); refresh(); } catch (e) { toast(e.message); }
  }));
}

// ---------- 메모 ----------
function renderNotes(body) {
  const notes = [...S.data.notes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  body.innerHTML = `
    ${canEdit() ? '<button class="btn primary block" data-new>＋ 새 메모</button>' : ''}
    <div class="notes">${notes.map((n) => `
      <div class="note">
        <textarea class="input" data-note="${n.id}" rows="4" ${canEdit() ? '' : 'readonly'} placeholder="메모를 입력하세요">${esc(n.content)}</textarea>
        <div class="note-foot"><small class="muted">${esc(nameOf(n.created_by))} · ${timeAgo(n.updated_at || n.created_at)}</small>
        ${canEdit() ? `<button class="mini-btn" data-del="${n.id}">삭제</button>` : ''}</div>
      </div>`).join('')}</div>
    ${notes.length ? '' : '<p class="muted center">숙소 체크인 시간, 맛집 후보 등 자유롭게 적어두세요.</p>'}`;
  const nb = $('[data-new]', body);
  if (nb) nb.onclick = async () => {
    try {
      const n = await store.insertRow('notes', { trip_id: S.tripId, content: '' });
      await refresh();
      $(`[data-note="${n.id}"]`)?.focus();
    } catch (e) { toast(e.message); }
  };
  $$('[data-note]', body).forEach((ta) => {
    ta.onblur = async () => {
      const n = S.data.notes.find((x) => x.id === ta.dataset.note);
      if (!n || n.content === ta.value) return;
      try { await store.updateRow('notes', n.id, { content: ta.value }); n.content = ta.value; toast('메모 저장됨', 1200); } catch (e) { toast(e.message); }
    };
  });
  $$('[data-del]', body).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('이 메모를 삭제할까요?', '삭제', true))) return;
    try { await store.deleteRow('notes', b.dataset.del); refresh(); } catch (e) { toast(e.message); }
  }));
}

// ---------- 가계부 ----------
const CATS = { 식비: '🍚', 숙소: '🏨', 교통: '🚗', 관광: '🎡', 카페: '☕', 쇼핑: '🛍️', 기타: '💳' };

export function settle(expenses, memberIds) {
  const bal = Object.fromEntries(memberIds.map((id) => [id, 0]));
  for (const e of expenses) {
    const parts = e.participants?.length ? e.participants : memberIds;
    const share = e.amount / parts.length;
    parts.forEach((p) => (bal[p] = (bal[p] || 0) - share));
    if (e.paid_by) bal[e.paid_by] = (bal[e.paid_by] || 0) + e.amount;
  }
  const cred = Object.entries(bal).filter(([, v]) => v > 0.5).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const debt = Object.entries(bal).filter(([, v]) => v < -0.5).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i].v, cred[j].v);
    if (Math.round(amt) > 0) transfers.push({ from: debt[i].id, to: cred[j].id, amount: Math.round(amt) });
    debt[i].v -= amt; cred[j].v -= amt;
    if (debt[i].v < 0.5) i++;
    if (cred[j].v < 0.5) j++;
  }
  return { bal, transfers };
}

function renderBudget(body) {
  const ex = [...S.data.expenses].sort((a, b) => ((b.spent_on || '') + b.created_at > (a.spent_on || '') + a.created_at ? 1 : -1));
  const ids = S.data.members.map((m) => m.user_id);
  const total = ex.reduce((s, e) => s + Number(e.amount), 0);
  const { bal, transfers } = settle(ex.map((e) => ({ ...e, amount: Number(e.amount) })), ids);
  const byCat = {};
  ex.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount)));
  const spentBy = (uid) => ex.filter((e) => e.paid_by === uid).reduce((s, e) => s + Number(e.amount), 0);

  body.innerHTML = `
    <div class="budget-total">
      <small>총 지출</small><b>${won(total)}</b>
      <small class="muted">1인 평균 ${won(total / Math.max(ids.length, 1))}</small>
    </div>
    ${total ? `<div class="cat-bar">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
      `<span title="${esc(c)}" style="flex:${v}" class="cat-${esc(c)}"></span>`).join('')}</div>
      <div class="cat-legend">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<span><i class="dot cat-${esc(c)}"></i>${CATS[c] || ''}${esc(c)} ${won(v)}</span>`).join('')}</div>` : ''}
    ${canEdit() ? '<button class="btn primary block" data-add>＋ 지출 추가</button>' : ''}

    ${ex.length ? `
    <h3 class="sub-title">정산</h3>
    <div class="settle">
      ${S.data.members.map((m) => `
        <div class="settle-row">${avatar(m, 26)}<span class="grow">${esc(m.nickname)}</span>
          <small class="muted">낸 돈 ${won(spentBy(m.user_id))}</small>
          <b class="${(bal[m.user_id] || 0) >= 0 ? 'plus' : 'minus'}">${(bal[m.user_id] || 0) >= 0 ? '+' : ''}${won(bal[m.user_id] || 0)}</b></div>`).join('')}
      <div class="transfers">${transfers.length ? transfers.map((t) => `
        <div class="transfer"><b>${esc(nameOf(t.from))}</b> → <b>${esc(nameOf(t.to))}</b><span class="grow"></span><b>${won(t.amount)}</b></div>`).join('')
        : '<p class="muted small">정산할 금액이 없어요 👍</p>'}</div>
    </div>
    <h3 class="sub-title">지출 내역</h3>
    <ul class="expense-list">${ex.map((e) => `
      <li class="expense" data-id="${e.id}">
        <span class="cat-icon">${CATS[e.category] || '💳'}</span>
        <div class="grow"><b>${esc(e.title)}</b>
          <small class="muted">${e.spent_on ? fmtDate(e.spent_on) + ' · ' : ''}${esc(nameOf(e.paid_by))} 결제 · ${(e.participants?.length || ids.length)}명</small></div>
        <b>${won(e.amount)}</b>
      </li>`).join('')}</ul>` : '<p class="muted center">지출을 추가하면 누가 누구에게 얼마를 보내면 되는지 자동으로 계산해 드려요.</p>'}`;

  const add = $('[data-add]', body);
  if (add) add.onclick = () => openExpenseEditor(null);
  if (canEdit()) $$('.expense', body).forEach((li) => (li.onclick = () => openExpenseEditor(S.data.expenses.find((e) => e.id === li.dataset.id))));
}

function openExpenseEditor(exp) {
  const isNew = !exp;
  const ids = S.data.members.map((m) => m.user_id);
  const today = isoDate(new Date());
  const t = S.data.trip;
  const f = exp ? { ...exp, participants: exp.participants?.length ? exp.participants : ids }
    : { title: '', amount: '', category: '식비', paid_by: session.user.id, participants: [...ids],
        spent_on: today >= t.start_date && today <= t.end_date ? today : t.start_date };
  openSheet({
    title: isNew ? '지출 추가' : '지출 수정',
    full: true,
    render(body, close) {
      if (body.dataset.ready) return;
      body.dataset.ready = '1';
      const dateOpts = [...Array(days()).keys()].map((d) => addDays(t.start_date, d));
      if (f.spent_on && !dateOpts.includes(f.spent_on)) dateOpts.unshift(f.spent_on);
      body.innerHTML = `
        <label class="field"><span>금액</span><input class="input big" data-amount inputmode="numeric" placeholder="0" value="${f.amount ? Number(f.amount).toLocaleString('ko-KR') : ''}"></label>
        <label class="field"><span>내용</span><input class="input" data-title maxlength="40" placeholder="예: 저녁 – 돼지국밥" value="${esc(f.title)}"></label>
        <div class="field"><span>분류</span><div class="chips" data-cats>${Object.entries(CATS).map(([c, i]) =>
          `<button type="button" class="chip ${f.category === c ? 'on' : ''}" data-cat="${c}">${i} ${c}</button>`).join('')}</div></div>
        <div class="row gap">
          <label class="field grow"><span>결제한 사람</span><select class="input" data-paid>${S.data.members.map((m) =>
            `<option value="${m.user_id}" ${m.user_id === f.paid_by ? 'selected' : ''}>${esc(m.nickname)}</option>`).join('')}</select></label>
          <label class="field grow"><span>날짜</span><select class="input" data-date>${dateOpts.map((d) =>
            `<option value="${d}" ${d === f.spent_on ? 'selected' : ''}>${fmtDate(d)}</option>`).join('')}</select></label>
        </div>
        <div class="field"><span>함께 나눌 사람 <small class="muted" data-per></small></span>
          <div class="chips">${S.data.members.map((m) =>
            `<button type="button" class="chip ${f.participants.includes(m.user_id) ? 'on' : ''}" data-part="${m.user_id}">${esc(m.nickname)}</button>`).join('')}</div></div>
        <div class="row gap sheet-actions">
          ${isNew ? '' : '<button class="btn danger ghost" data-del>삭제</button>'}
          <button class="btn primary grow" data-save>${isNew ? '추가' : '저장'}</button>
        </div>`;
      const amountEl = $('[data-amount]', body);
      const amount = () => Number(amountEl.value.replace(/[^\d]/g, '')) || 0;
      const per = () => { $('[data-per]', body).textContent = f.participants.length ? `· 1인 ${won(amount() / f.participants.length)}` : ''; };
      amountEl.oninput = () => { const v = amount(); amountEl.value = v ? v.toLocaleString('ko-KR') : ''; per(); };
      $$('[data-cat]', body).forEach((b) => (b.onclick = () => {
        f.category = b.dataset.cat; $$('[data-cat]', body).forEach((x) => x.classList.toggle('on', x === b));
      }));
      $$('[data-part]', body).forEach((b) => (b.onclick = () => {
        const id = b.dataset.part;
        f.participants = f.participants.includes(id) ? f.participants.filter((x) => x !== id) : [...f.participants, id];
        b.classList.toggle('on'); per();
      }));
      per();
      if (isNew) setTimeout(() => amountEl.focus(), 300);
      $('[data-save]', body).onclick = async (e) => {
        if (!amount()) return toast('금액을 입력하세요');
        if (!f.participants.length) return toast('나눌 사람을 한 명 이상 골라주세요');
        const row = {
          title: $('[data-title]', body).value.trim() || f.category, amount: amount(), category: f.category,
          paid_by: $('[data-paid]', body).value, spent_on: $('[data-date]', body).value,
          participants: f.participants,
        };
        e.target.disabled = true;
        try {
          if (isNew) await store.insertRow('expenses', { trip_id: S.tripId, ...row });
          else await store.updateRow('expenses', exp.id, row);
          close(); refresh();
        } catch (err) { toast(err.message); e.target.disabled = false; }
      };
      const del = $('[data-del]', body);
      if (del) del.onclick = async () => {
        if (!(await confirmBox(`'${exp.title}' 지출을 삭제할까요?`, '삭제', true))) return;
        try { await store.deleteRow('expenses', exp.id); close(); refresh(); } catch (err) { toast(err.message); }
      };
    },
  });
}

// ---------- 수정 기록 ----------
const ENTITY = { itinerary_items: '일정', checklist_items: '준비물', notes: '메모', expenses: '지출', trips: '여행 정보', trip_members: '일행' };
const FIELD = {
  title: '이름', time: '시간', memo: '메모', place_name: '장소', address: '주소', day_index: '날짜', lat: null, lng: null, kakao_place_id: null,
  text: '내용', checked: '체크', content: '내용', amount: '금액', category: '분류', paid_by: '결제자', participants: '나눈 사람',
  spent_on: '날짜', regions: '지역', start_date: '출발일', end_date: '도착일', role: '권한',
};
const josa = (w, a, b) => {
  const c = (w || '').charCodeAt((w || '').length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 ? a : b;
};

function fmtVal(field, v) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length && field !== 'participants')) return '(없음)';
  switch (field) {
    case 'day_index': return `${v + 1}일차`;
    case 'amount': return won(v);
    case 'checked': return v ? '챙김' : '안 챙김';
    case 'paid_by': return nameOf(v);
    case 'participants': return v.length ? v.map(nameOf).join(', ') : '전원';
    case 'regions': return v.map((r) => r.name).join(', ');
    case 'role': return ROLE_LABEL[v] || v;
    case 'start_date': case 'end_date': case 'spent_on': return fmtDate(v);
    default: { const s = String(v); return s.length > 40 ? s.slice(0, 40) + '…' : s; }
  }
}

function logSentence(l) {
  const who = nameOf(l.user_id);
  const ent = ENTITY[l.entity] || l.entity;
  const label = l.label ? `'${l.label}'` : '';
  if (l.entity === 'trips' && l.action === 'insert') return `<b>${esc(who)}</b>님이 여행을 만들었어요`;
  if (l.entity === 'trip_members') {
    const target = l.label || '일행';
    if (l.action === 'insert') return `<b>${esc(target)}</b>님이 ${ROLE_LABEL[l.changes?.role?.[1]] || ''} 권한으로 참여했어요`;
    if (l.action === 'update') return `<b>${esc(who)}</b>님이 ${esc(target)}님의 권한을 바꿨어요`;
    return l.user_id === l.entity_id ? `<b>${esc(target)}</b>님이 여행에서 나갔어요` : `<b>${esc(who)}</b>님이 ${esc(target)}님을 내보냈어요`;
  }
  if (l.entity === 'checklist_items' && l.action === 'update' && l.changes && Object.keys(l.changes).length === 1 && 'checked' in l.changes) {
    return `<b>${esc(who)}</b>님이 준비물 ${esc(label)}${josa(l.label, '을', '를')} ${l.changes.checked[1] ? '챙겼어요 ✅' : '체크 해제했어요'}`;
  }
  const verb = { insert: '추가했어요', update: '수정했어요', delete: '삭제했어요' }[l.action];
  const obj = l.entity === 'trips' ? '여행 정보' : `${ent} ${label}`;
  return `<b>${esc(who)}</b>님이 ${esc(obj.trim())}${josa(l.entity === 'trips' ? '보' : (l.label || ent), '을', '를')} ${verb}`;
}

function changeLines(l) {
  if (l.action !== 'update' || !l.changes) return '';
  if (l.entity === 'trip_members' || (l.entity === 'checklist_items' && 'checked' in l.changes && Object.keys(l.changes).length === 1)) {
    if (l.entity !== 'trip_members') return '';
  }
  const lines = [];
  const ch = l.changes;
  if ('lat' in ch || 'place_name' in ch) {
    if ('place_name' in ch) lines.push(['장소', fmtVal('place_name', ch.place_name[0]), fmtVal('place_name', ch.place_name[1])]);
    else lines.push(['장소', '위치 변경', '']);
  }
  for (const [k, [a, b]] of Object.entries(ch)) {
    if (!(k in FIELD) || FIELD[k] === null || k === 'place_name' || k === 'address') continue;
    lines.push([FIELD[k], fmtVal(k, a), fmtVal(k, b)]);
  }
  return lines.length ? `<ul class="diff">${lines.map(([f, a, b]) =>
    `<li><span class="diff-f">${esc(f)}</span><del>${esc(a)}</del>${b !== '' ? ` → <ins>${esc(b)}</ins>` : ''}</li>`).join('')}</ul>` : '';
}

const LOG_FILTERS = [['all', '전체'], ['itinerary_items', '일정'], ['expenses', '가계부'], ['checklist_items', '준비물'], ['notes', '메모'], ['trip_members', '일행']];
let logFilter = 'all';

async function renderLogs(body) {
  if (!body.dataset.ready) { body.innerHTML = '<div class="loading">불러오는 중…</div>'; body.dataset.ready = '1'; }
  let logs;
  try { logs = await store.listLogs(S.tripId); } catch (e) { body.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const shown = logFilter === 'all' ? logs : logs.filter((l) => l.entity === logFilter || (logFilter === 'itinerary_items' && l.entity === 'trips'));
  const byUser = {};
  logs.forEach((l) => (byUser[l.user_id] = (byUser[l.user_id] || 0) + 1));
  body.innerHTML = `
    <div class="chips">${LOG_FILTERS.map(([k, v]) => `<button class="chip ${logFilter === k ? 'on' : ''}" data-f="${k}">${v}</button>`).join('')}</div>
    <ul class="log-list">${shown.map((l) => `
      <li class="log">
        ${avatar(S.data.members.find((m) => m.user_id === l.user_id) || { nickname: nameOf(l.user_id) }, 30)}
        <div class="grow">
          <div class="log-text">${logSentence(l)}</div>
          ${changeLines(l)}
          <small class="muted">${timeAgo(l.created_at)}</small>
        </div>
      </li>`).join('')}</ul>
    ${shown.length ? '' : '<p class="muted center">아직 기록이 없어요.</p>'}`;
  $$('[data-f]', body).forEach((b) => (b.onclick = () => { logFilter = b.dataset.f; renderLogs(body); }));
}
