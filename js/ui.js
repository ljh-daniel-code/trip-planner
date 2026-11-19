// 공용 UI 도우미
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const won = (n) => (Math.round(n) || 0).toLocaleString('ko-KR') + '원';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function fmtDate(s, withWeek = true) {
  const d = typeof s === 'string' ? parseDate(s) : s;
  return `${d.getMonth() + 1}.${d.getDate()}${withWeek ? ` (${WEEK[d.getDay()]})` : ''}`;
}
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); }
export function dayCount(start, end) { return Math.round((parseDate(end) - parseDate(start)) / 864e5) + 1; }
export function tripRangeLabel(t) {
  const n = dayCount(t.start_date, t.end_date);
  return `${fmtDate(t.start_date)} ~ ${fmtDate(t.end_date)} · ${n === 1 ? '당일치기' : `${n - 1}박 ${n}일`}`;
}
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function toast(msg, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

// 바텀시트. render(body, close) 로 내용 채움. 반환값: { close, body, rerender }
let sheetStack = [];
export function openSheet({ title, render, full = false, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet ${full ? 'full' : ''}" role="dialog" aria-label="${esc(title)}">
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn sheet-close" aria-label="닫기">✕</button>
      </header>
      <div class="sheet-body"></div>
    </section>`;
  document.body.appendChild(wrap);
  const body = $('.sheet-body', wrap);
  const api = {
    body,
    close() {
      wrap.classList.remove('open');
      sheetStack = sheetStack.filter((s) => s !== api);
      setTimeout(() => wrap.remove(), 250);
      onClose?.();
    },
    rerender() { const y = body.scrollTop; render(body, api.close); body.scrollTop = y; },
  };
  $('.sheet-backdrop', wrap).onclick = api.close;
  $('.sheet-close', wrap).onclick = api.close;
  render(body, api.close);
  sheetStack.push(api);
  requestAnimationFrame(() => wrap.classList.add('open'));
  return api;
}
export const openSheets = () => sheetStack;
export function closeAllSheets() { [...sheetStack].forEach((s) => s.close()); }

export function confirmBox(message, okLabel = '확인', danger = false) {
  return new Promise((resolve) => {
    const s = openSheet({
      title: '확인',
      render(body) {
        body.innerHTML = `<p class="confirm-msg">${esc(message)}</p>
          <div class="row gap"><button class="btn ghost grow" data-no>취소</button>
          <button class="btn grow ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`;
        // 먼저 결과를 확정한 뒤 닫기 (닫을 때 onClose 가 false 로 먼저 확정하지 않도록)
        $('[data-no]', body).onclick = () => { resolve(false); s?.close(); };
        $('[data-ok]', body).onclick = () => { resolve(true); s?.close(); };
      },
      onClose: () => resolve(false),
    });
  });
}

export function avatar(m, size = 32) {
  const name = m?.nickname || '?';
  if (m?.avatar_url) return `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(m.avatar_url)}" alt="" referrerpolicy="no-referrer">`;
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:hsl(${hue} 55% 55%)">${esc(name.slice(0, 1))}</span>`;
}

export const ROLE_LABEL = { owner: '방장', editor: '편집 가능', viewer: '보기만' };
