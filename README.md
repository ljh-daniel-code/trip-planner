# 여행 플래너

일행과 함께 짜는 국내 여행 플래너 (아이폰 홈 화면 앱 / PWA)

- 일행 초대: **같이 수정하기 / 보기만 하기** 를 골라 초대 링크 공유 (카톡 등)
- 수정 기록: 누가 · 언제 · 무엇을 · 어떻게(이전 → 이후) 바꿨는지
- 지역 검색: '서' → 서울특별시, 서귀포시, 서산시… (초성 'ㅈㅈ' 도 가능, 여러 지역 선택 가능)
- 일정: 날짜별 일정 + 카카오맵에 1→2→3 번호 마커와 동선 표시
- 상단 항목: 👥 일행 · 🎒 준비물 · 📝 메모 · 💰 가계부(N빵 + 자동 정산) · 🕘 기록

키를 넣지 않으면 **데모 모드**(이 기기에만 저장)로 동작하니, 먼저 화면을 둘러볼 수 있어요.

---

## 전체 순서 (약 30~40분)

1. GitHub 에 올리고 주소 받기 → `https://아이디.github.io/trip-planner/`
2. 카카오 개발자 앱 만들기 → JavaScript 키 (지도) + 카카오 로그인 설정
3. Supabase 프로젝트 만들기 → DB 설치 + 로그인 연결
4. (선택) 구글 로그인 연결
5. `js/config.js` 에 키 3개 넣고 다시 올리기
6. 아이폰 Safari 로 열고 → 공유 → **홈 화면에 추가**

---

## 1. GitHub 에 올리기

1. https://github.com 가입 → 오른쪽 위 **＋ → New repository**
2. Repository name: `trip-planner`, **Public** 선택 → Create
3. **uploading an existing file** 링크 클릭 → 이 폴더 안의 파일/폴더 전부를 끌어다 놓기 → Commit changes
4. 저장소 **Settings → Pages** → Branch: `main`, 폴더 `/ (root)` → Save
5. 1~2분 뒤 `https://아이디.github.io/trip-planner/` 로 접속되면 성공 (이 주소를 아래에서 계속 씁니다)

> 수정할 때는 바뀐 파일만 같은 방법으로 다시 업로드하면 덮어써져요.

## 2. 카카오 개발자 (평소 쓰는 카카오 계정으로 로그인)

1. https://developers.kakao.com → 로그인 → **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름: 여행 플래너)
2. **앱 설정 → 앱 키** 에서
   - **JavaScript 키** 복사 → `config.js` 의 `KAKAO_JS_KEY`
   - **REST API 키** 복사 → Supabase 설정(3-4)에서 사용
3. **앱 설정 → 플랫폼 → Web 플랫폼 등록** → 사이트 도메인에 아래 두 줄 추가
   - `https://아이디.github.io`
   - `http://localhost:8765` (내 PC에서 테스트할 때용, 선택)
4. **카카오맵 사용 설정**: 앱 설정(또는 제품 설정)에서 **카카오맵 → 사용 설정 ON** (안 켜면 지도가 안 떠요)
5. **제품 설정 → 카카오 로그인** → 활성화 ON
   - **Redirect URI** 에 `https://<Supabase프로젝트ID>.supabase.co/auth/v1/callback` 등록 (3번에서 확인)
   - **동의항목**: 닉네임, 프로필 사진 → '필수' 또는 '선택' 동의로 설정
   - **보안 → Client Secret** 생성 후 활성화, 코드 복사 → 3-4에서 사용

## 3. Supabase (GitHub 계정으로 가입 추천)

1. https://supabase.com → **Start your project** → GitHub 로 로그인
2. **New project**: 이름 `trip-planner`, DB 비밀번호 아무거나(메모), Region **Northeast Asia (Seoul)**
3. 프로젝트가 만들어지면 왼쪽 **SQL Editor → New query** → 이 폴더의 `supabase/schema.sql` 내용을 전부 붙여넣고 **Run**
   ("Success" 가 뜨면 표, 권한, 수정기록 자동 저장이 모두 설치된 것)
4. **Authentication → Sign In / Providers → Kakao** 켜기
   - REST API Key → `Client ID` 칸, Client Secret → `Client Secret` 칸
   - **Allow users without an email** 켜기 (카카오 이메일은 비즈앱만 받을 수 있어서)
   - 여기 표시된 Callback URL 을 2-5 의 Redirect URI 에 넣었는지 확인
5. **Authentication → URL Configuration**
   - Site URL: `https://아이디.github.io/trip-planner/`
   - Redirect URLs 에 추가: `https://아이디.github.io/trip-planner/` (테스트용 `http://localhost:8765/` 도 선택)
6. **Project Settings → API (Data API / API Keys)** 에서
   - Project URL → `config.js` 의 `SUPABASE_URL`
   - `anon` `public` 키 → `config.js` 의 `SUPABASE_ANON_KEY`
   - ⚠️ `service_role` 키는 절대 넣지 마세요 (이건 비밀 키)

> 무료 플랜은 1주일 동안 아무 접속이 없으면 일시정지돼요. 대시보드에서 **Restore** 누르면 데이터 그대로 다시 켜져요.

## 4. (선택) 구글 로그인

1. https://console.cloud.google.com → 프로젝트 만들기 → **API 및 서비스 → OAuth 동의 화면** 설정 (외부, 앱 이름/이메일만)
2. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기** → 웹 애플리케이션
   - 승인된 리디렉션 URI: `https://<Supabase프로젝트ID>.supabase.co/auth/v1/callback`
3. 나온 Client ID / Secret 을 Supabase **Authentication → Providers → Google** 에 입력 후 켜기
4. 동의 화면을 **프로덕션으로 게시**해야 테스트 사용자 외 일행도 로그인 가능

## 5. 키 넣기

`js/config.js` 를 열어 세 값을 채우고 GitHub 에 다시 업로드:

```js
export const CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
  KAKAO_JS_KEY: 'abcd1234...',
};
```

이 키들은 공개 저장소에 올라가도 괜찮은 키예요. 카카오 키는 등록한 도메인에서만 동작하고, Supabase 는 DB 권한 규칙(RLS)으로 일행이 아닌 사람의 접근을 막아요.

## 6. 아이폰에 설치

1. Safari 로 `https://아이디.github.io/trip-planner/` 접속
2. 아래 **공유 버튼(□↑) → 홈 화면에 추가**
3. 홈 화면 아이콘으로 열고 로그인

**초대받은 일행은**: 카톡 링크 → Safari 에서 열림 → 로그인 → 참여하기 → (원하면) 홈 화면에 추가 후 그 앱에서 한 번 더 로그인.
iOS 는 Safari 와 홈 화면 앱의 로그인 상태가 따로라서 그래요.

---

## 권한 정리

| | 방장 | 같이 수정하기 | 보기만 하기 |
|---|:-:|:-:|:-:|
| 일정·준비물·메모·가계부 보기 | ✅ | ✅ | ✅ |
| 일정·준비물·메모·가계부 수정 | ✅ | ✅ | ❌ |
| 일행 초대 링크 만들기 | ✅ | ✅ | ❌ |
| 일행 권한 변경 / 내보내기 | ✅ | ❌ | ❌ |
| 여행 삭제 | ✅ | ❌ | ❌ |

권한은 화면뿐 아니라 DB 에서도 막혀 있어서, '보기만' 일행이 우회해서 수정하는 것도 불가능해요.
수정 기록도 DB 가 자동으로 남기며 앱에서 지우거나 조작할 수 없어요.

## 파일 구조

```
index.html            앱 시작 파일
manifest.webmanifest  홈 화면 앱 설정
sw.js                 오프라인/빠른 실행용 캐시
css/style.css         디자인
js/config.js          ← 키 넣는 곳
js/app.js             로그인 · 내 여행 · 새 여행(지역/날짜) · 초대 수락 · 설정
js/trip.js            여행 화면 (지도 · 일정 · 일행 · 준비물 · 메모 · 가계부 · 기록)
js/store.js           데이터 저장 (Supabase / 데모 모드)
js/map.js             카카오맵 (마커, 동선, 장소 검색)
js/regions.js         전국 시·도 / 시·군·구 목록과 검색
supabase/schema.sql   DB 설치 스크립트
```
