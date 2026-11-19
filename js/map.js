// 카카오맵 래퍼: 지도 표시, 번호 마커 + 동선, 장소 검색, 지역 좌표 찾기
import { CONFIG } from './config.js';

let loading = null;
export const hasMapKey = () => !!CONFIG.KAKAO_JS_KEY;

export function loadKakao() {
  if (!hasMapKey()) return Promise.reject(new Error('카카오 JavaScript 키가 설정되지 않았어요'));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(CONFIG.KAKAO_JS_KEY)}&libraries=services&autoload=false`;
    s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    s.onerror = () => { loading = null; reject(new Error('카카오맵을 불러오지 못했어요. 키와 등록된 도메인을 확인하세요.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export const DAY_COLORS = ['#3b6ef5', '#f0663a', '#16a37f', '#a35bd9', '#e0a100', '#e04a8a', '#1f9bb5', '#7a8a1c'];

export class TripMap {
  constructor(el) {
    this.el = el;
    this.map = null;
    this.overlays = [];
    this.lines = [];
  }

  async init(center) {
    const kakao = await loadKakao();
    this.kakao = kakao;
    const c = center ? new kakao.maps.LatLng(center.lat, center.lng) : new kakao.maps.LatLng(36.5, 127.8);
    this.map = new kakao.maps.Map(this.el, { center: c, level: center ? 8 : 13 });
    this.map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    return this;
  }

  relayout() { this.map?.relayout(); }

  clear() {
    this.overlays.forEach((o) => o.setMap(null));
    this.lines.forEach((l) => l.setMap(null));
    this.overlays = []; this.lines = [];
  }

  // groups: [{ color, points: [{ n, lat, lng, title, id }] }]
  draw(groups, onClick, fallbackCenter) {
    if (!this.map) return;
    const { kakao } = this;
    this.clear();
    const bounds = new kakao.maps.LatLngBounds();
    let count = 0;
    for (const g of groups) {
      const path = [];
      for (const p of g.points) {
        const pos = new kakao.maps.LatLng(p.lat, p.lng);
        path.push(pos); bounds.extend(pos); count++;
        const node = document.createElement('button');
        node.className = 'map-pin';
        node.style.background = g.color;
        node.textContent = p.n;
        node.title = p.title;
        node.addEventListener('click', () => onClick?.(p.id));
        const ov = new kakao.maps.CustomOverlay({ position: pos, content: node, yAnchor: 0.5, zIndex: 3 });
        ov.setMap(this.map);
        this.overlays.push(ov);
      }
      if (path.length > 1) {
        const line = new kakao.maps.Polyline({
          path, strokeWeight: 4, strokeColor: g.color, strokeOpacity: 0.85, strokeStyle: 'solid', endArrow: true,
        });
        line.setMap(this.map);
        this.lines.push(line);
      }
    }
    if (count === 1) {
      this.map.setLevel(5);
      this.map.setCenter(bounds.getSouthWest());
    } else if (count > 1) {
      this.map.setBounds(bounds, 60, 40, 40, 40);
    } else if (fallbackCenter) {
      this.map.setCenter(new kakao.maps.LatLng(fallbackCenter.lat, fallbackCenter.lng));
      this.map.setLevel(8);
    }
  }

  focus(lat, lng) {
    if (!this.map) return;
    this.map.setLevel(4);
    this.map.panTo(new this.kakao.maps.LatLng(lat, lng));
  }
}

// 장소 검색 (지역 중심 근처 우선)
export async function searchPlaces(keyword, near) {
  const kakao = await loadKakao();
  const ps = new kakao.maps.services.Places();
  const opts = { size: 15 };
  if (near) { opts.location = new kakao.maps.LatLng(near.lat, near.lng); opts.sort = kakao.maps.services.SortBy.ACCURACY; }
  return new Promise((resolve) => {
    ps.keywordSearch(keyword, (data, status) => {
      if (status !== kakao.maps.services.Status.OK) return resolve([]);
      resolve(data.map((d) => ({
        id: d.id, name: d.place_name, address: d.road_address_name || d.address_name,
        category: (d.category_name || '').split('>').pop().trim(),
        lat: parseFloat(d.y), lng: parseFloat(d.x),
      })));
    }, opts);
  });
}

// 지역 이름 → 좌표
export async function geocodeRegion(full) {
  try {
    const kakao = await loadKakao();
    const geocoder = new kakao.maps.services.Geocoder();
    const viaAddr = await new Promise((resolve) => {
      geocoder.addressSearch(full, (data, status) => {
        if (status === kakao.maps.services.Status.OK && data[0]) resolve({ lat: +data[0].y, lng: +data[0].x });
        else resolve(null);
      });
    });
    if (viaAddr) return viaAddr;
    const places = await searchPlaces(full);
    return places[0] ? { lat: places[0].lat, lng: places[0].lng } : null;
  } catch {
    return null;
  }
}

// 카카오맵 앱/웹으로 길찾기 링크
export function kakaoMapLink(item) {
  if (item.kakao_place_id) return `https://place.map.kakao.com/${item.kakao_place_id}`;
  if (item.lat) return `https://map.kakao.com/link/map/${encodeURIComponent(item.title)},${item.lat},${item.lng}`;
  return null;
}
