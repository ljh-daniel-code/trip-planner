// 데이터 계층: Supabase(실서비스) 또는 localStorage(데모 모드)
import { CONFIG } from './config.js';

const DATA_TABLES = ['itinerary_items', 'checklist_items', 'notes', 'expenses'];
const LOG_IGNORED = ['updated_at', 'created_at', 'id', 'trip_id', 'created_by', 'position', 'owner_id'];

// 주소 끝에 ?demo 를 붙이면 실제 데이터와 분리된 데모 모드로 열림 (테스트용)
export const isDemo = !(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) || new URLSearchParams(location.search).has('demo');

let sb = null;

export async function initStore() {
  if (isDemo) return;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  // OAuth 콜백(?code=...) 처리 후 주소창 정리
  if (new URLSearchParams(location.search).has('code')) {
    await sb.auth.getSession();
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// =============== 데모(로컬) 저장소 ===============
const DEMO_KEY = 'tp-demo-db-v1';
const DEMO_ME = { id: 'demo-me', nickname: '나', avatar_url: null };

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
function demoLoad() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    profiles: [DEMO_ME], trips: [], trip_members: [], trip_invites: [],
    itinerary_items: [], checklist_items: [], notes: [], expenses: [], activity_logs: [], seq: 1,
  };
}
let demo = isDemo ? demoLoad() : null;
const demoListeners = new Set();
function demoSave() {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(demo)); } catch {}
  demoListeners.forEach((fn) => fn());
}
function demoLog(trip_id, action, entity, rec, changes = null) {
  demo.activity_logs.push({
    id: demo.seq++, trip_id, user_id: DEMO_ME.id, action, entity, entity_id: rec.id || rec.user_id,
    label: rec.title || rec.text || (rec.content || '').slice(0, 30) || rec.nickname || null,
    changes, created_at: new Date().toISOString(),
  });
}
function diffOf(oldR, newR) {
  const d = {};
  for (const k of Object.keys(newR)) {
    if (LOG_IGNORED.includes(k)) continue;
    if (JSON.stringify(oldR[k] ?? null) !== JSON.stringify(newR[k] ?? null)) d[k] = [oldR[k] ?? null, newR[k] ?? null];
  }
  return Object.keys(d).length ? d : null;
}

// =============== 인증 ===============
export async function getUser() {
  if (isDemo) return DEMO_ME;
  const { data } = await sb.auth.getSession();
  return data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
}

export function onAuthChange(cb) {
  if (isDemo) return;
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') cb(event);
  });
}

export async function signIn(provider) {
  const opts = { redirectTo: location.origin + location.pathname };
  const { error } = await sb.auth.signInWithOAuth({ provider, options: opts });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  if (isDemo) return;
  await sb.auth.signOut();
}

export async function getProfile(userId) {
  if (isDemo) return demo.profiles.find((p) => p.id === userId) || DEMO_ME;
  return check(await sb.from('profiles').select('*').eq('id', userId).maybeSingle());
}

export async function updateNickname(userId, nickname) {
  if (isDemo) {
    const p = demo.profiles.find((x) => x.id === userId);
    if (p) p.nickname = nickname;
    return demoSave();
  }
  check(await sb.from('profiles').update({ nickname }).eq('id', userId));
}

// =============== 여행 ===============
export async function listTrips(userId) {
  if (isDemo) {
    return demo.trip_members.filter((m) => m.user_id === userId)
      .map((m) => ({ ...demo.trips.find((t) => t.id === m.trip_id), my_role: m.role }))
      .filter((t) => t.id)
      .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  }
  const rows = check(await sb.from('trip_members')
    .select('role, trips(*)').eq('user_id', userId));
  return rows.filter((r) => r.trips).map((r) => ({ ...r.trips, my_role: r.role }))
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
}

export async function createTrip(userId, trip) {
  if (isDemo) {
    const row = { id: uid(), owner_id: userId, ...trip, created_at: new Date().toISOString() };
    demo.trips.push(row);
    demo.trip_members.push({ trip_id: row.id, user_id: userId, role: 'owner', joined_at: row.created_at });
    demoLog(row.id, 'insert', 'trips', row);
    demoSave();
    return row;
  }
  return check(await sb.from('trips').insert({ ...trip, owner_id: userId }).select().single());
}

export async function loadTrip(tripId, userId) {
  if (isDemo) {
    const trip = demo.trips.find((t) => t.id === tripId);
    if (!trip) return null;
    const me = demo.trip_members.find((m) => m.trip_id === tripId && m.user_id === userId);
    if (!me) return null;
    const members = demo.trip_members.filter((m) => m.trip_id === tripId).map((m) => {
      const p = demo.profiles.find((x) => x.id === m.user_id) || {};
      return { ...m, nickname: p.nickname || '알 수 없음', avatar_url: p.avatar_url };
    });
    const pick = (t) => demo[t].filter((r) => r.trip_id === tripId).map((r) => ({ ...r }));
    return {
      trip: { ...trip }, role: me.role, members,
      items: pick('itinerary_items'), checklist: pick('checklist_items'),
      notes: pick('notes'), expenses: pick('expenses'),
    };
  }
  const trip = check(await sb.from('trips').select('*').eq('id', tripId).maybeSingle());
  if (!trip) return null;
  const [members, items, checklist, notes, expenses] = await Promise.all([
    sb.from('trip_members').select('trip_id, user_id, role, joined_at').eq('trip_id', tripId).then(check),
    sb.from('itinerary_items').select('*').eq('trip_id', tripId).then(check),
    sb.from('checklist_items').select('*').eq('trip_id', tripId).then(check),
    sb.from('notes').select('*').eq('trip_id', tripId).then(check),
    sb.from('expenses').select('*').eq('trip_id', tripId).then(check),
  ]);
  const ids = members.map((m) => m.user_id);
  const profiles = ids.length ? check(await sb.from('profiles').select('*').in('id', ids)) : [];
  const me = members.find((m) => m.user_id === userId);
  return {
    trip, role: me?.role || 'viewer',
    members: members.map((m) => {
      const p = profiles.find((x) => x.id === m.user_id) || {};
      return { ...m, nickname: p.nickname || '알 수 없음', avatar_url: p.avatar_url };
    }),
    items, checklist, notes, expenses,
  };
}

export async function updateTrip(tripId, patch) {
  if (isDemo) {
    const t = demo.trips.find((x) => x.id === tripId);
    const before = { ...t };
    Object.assign(t, patch);
    const d = diffOf(before, t);
    if (d) demoLog(tripId, 'update', 'trips', t, d);
    return demoSave();
  }
  check(await sb.from('trips').update(patch).eq('id', tripId));
}

export async function deleteTrip(tripId) {
  if (isDemo) {
    demo.trips = demo.trips.filter((t) => t.id !== tripId);
    for (const k of ['trip_members', 'trip_invites', 'activity_logs', ...DATA_TABLES]) {
      demo[k] = demo[k].filter((r) => r.trip_id !== tripId);
    }
    return demoSave();
  }
  check(await sb.from('trips').delete().eq('id', tripId));
}

// =============== 일정/준비물/메모/가계부 공통 ===============
export async function insertRow(table, row) {
  if (isDemo) {
    const r = { id: uid(), created_by: DEMO_ME.id, created_at: new Date().toISOString(), ...row };
    demo[table].push(r);
    demoLog(r.trip_id, 'insert', table, r);
    demoSave();
    return r;
  }
  return check(await sb.from(table).insert(row).select().single());
}

export async function updateRow(table, id, patch) {
  if (isDemo) {
    const r = demo[table].find((x) => x.id === id);
    if (!r) return;
    const before = { ...r };
    Object.assign(r, patch, { updated_at: new Date().toISOString() });
    const d = diffOf(before, r);
    if (d) demoLog(r.trip_id, 'update', table, r, d);
    return demoSave();
  }
  check(await sb.from(table).update(patch).eq('id', id));
}

export async function deleteRow(table, id) {
  if (isDemo) {
    const r = demo[table].find((x) => x.id === id);
    if (!r) return;
    demo[table] = demo[table].filter((x) => x.id !== id);
    demoLog(r.trip_id, 'delete', table, r);
    return demoSave();
  }
  check(await sb.from(table).delete().eq('id', id));
}

// 순서 변경 (기록에는 남기지 않음 – position 은 무시 필드)
export async function reorder(table, rows) {
  if (isDemo) {
    rows.forEach(({ id, position, day_index }) => {
      const r = demo[table].find((x) => x.id === id);
      if (r) { r.position = position; if (day_index !== undefined) r.day_index = day_index; }
    });
    return demoSave();
  }
  await Promise.all(rows.map(({ id, ...patch }) => sb.from(table).update(patch).eq('id', id).then(check)));
}

// =============== 수정 기록 ===============
export async function listLogs(tripId, limit = 200) {
  if (isDemo) {
    return demo.activity_logs.filter((l) => l.trip_id === tripId)
      .sort((a, b) => b.id - a.id).slice(0, limit);
  }
  return check(await sb.from('activity_logs').select('*').eq('trip_id', tripId)
    .order('created_at', { ascending: false }).limit(limit));
}

// =============== 일행 / 초대 ===============
export async function createInvite(tripId, role) {
  if (isDemo) {
    const inv = { id: uid(), trip_id: tripId, token: uid().replace(/-/g, ''), role, created_by: DEMO_ME.id,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), revoked: false };
    demo.trip_invites.push(inv);
    demoSave();
    return inv;
  }
  return check(await sb.from('trip_invites').insert({ trip_id: tripId, role }).select().single());
}

export async function listInvites(tripId) {
  if (isDemo) {
    return demo.trip_invites.filter((i) => i.trip_id === tripId && !i.revoked && new Date(i.expires_at) > new Date());
  }
  return check(await sb.from('trip_invites').select('*').eq('trip_id', tripId).eq('revoked', false)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }));
}

export async function revokeInvite(id) {
  if (isDemo) {
    const i = demo.trip_invites.find((x) => x.id === id);
    if (i) i.revoked = true;
    return demoSave();
  }
  check(await sb.from('trip_invites').update({ revoked: true }).eq('id', id));
}

export async function getInvite(token) {
  if (isDemo) {
    const i = demo.trip_invites.find((x) => x.token === token);
    if (!i) return null;
    const t = demo.trips.find((x) => x.id === i.trip_id);
    return { trip_id: t.id, title: t.title, start_date: t.start_date, end_date: t.end_date, role: i.role,
      inviter: DEMO_ME.nickname, valid: !i.revoked && new Date(i.expires_at) > new Date(), already_member: true };
  }
  const rows = check(await sb.rpc('get_invite', { p_token: token }));
  return rows?.[0] || null;
}

export async function acceptInvite(token) {
  if (isDemo) return (await getInvite(token))?.trip_id;
  return check(await sb.rpc('accept_invite', { p_token: token }));
}

export async function setMemberRole(tripId, userId, role) {
  if (isDemo) {
    const m = demo.trip_members.find((x) => x.trip_id === tripId && x.user_id === userId);
    const p = demo.profiles.find((x) => x.id === userId);
    demoLog(tripId, 'update', 'trip_members', { user_id: userId, nickname: p?.nickname }, { role: [m.role, role] });
    m.role = role;
    return demoSave();
  }
  check(await sb.from('trip_members').update({ role }).eq('trip_id', tripId).eq('user_id', userId));
}

export async function removeMember(tripId, userId) {
  if (isDemo) {
    const p = demo.profiles.find((x) => x.id === userId);
    demoLog(tripId, 'delete', 'trip_members', { user_id: userId, nickname: p?.nickname });
    demo.trip_members = demo.trip_members.filter((x) => !(x.trip_id === tripId && x.user_id === userId));
    return demoSave();
  }
  check(await sb.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId));
}

// 데모 모드 전용: 가상 일행 추가 (정산/권한 화면 테스트용)
export function demoAddFakeMember(tripId, nickname, role) {
  const id = 'demo-' + uid().slice(0, 8);
  demo.profiles.push({ id, nickname, avatar_url: null });
  demo.trip_members.push({ trip_id: tripId, user_id: id, role, joined_at: new Date().toISOString() });
  demoLog(tripId, 'insert', 'trip_members', { user_id: id, nickname }, { role: [null, role] });
  demoSave();
}

// =============== 실시간 ===============
export function subscribeTrip(tripId, onChange) {
  if (isDemo) {
    // 같은 기기의 다른 탭에서 수정했을 때도 반영
    const onStorage = (e) => { if (e.key === DEMO_KEY) { demo = demoLoad(); onChange(); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 250); };
  const ch = sb.channel('trip-' + tripId);
  for (const table of ['trips', 'trip_members', ...DATA_TABLES, 'activity_logs']) {
    const filter = table === 'trips' ? `id=eq.${tripId}` : `trip_id=eq.${tripId}`;
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, fire);
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, fire);
  }
  // DELETE 이벤트는 필터가 적용되지 않아 테이블 단위로 받고 화면에서 다시 불러옴
  for (const table of ['trip_members', ...DATA_TABLES]) {
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, fire);
  }
  ch.subscribe();
  // 홈 화면 앱이 백그라운드에서 돌아왔을 때 최신화
  const onVis = () => { if (document.visibilityState === 'visible') fire(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { sb.removeChannel(ch); document.removeEventListener('visibilitychange', onVis); };
}
