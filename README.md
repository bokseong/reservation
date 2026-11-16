# 복성고 먹거리 부스 예약 시스템

2026 복성고 학술문화제 먹거리 부스 1곳의 예약·대기열·수령·운영 기록을 관리하는 웹 시스템입니다.

- 고객: `index.html` — 예약/복구 조회, 조리 상태·완료 알림, 대기 상태 실시간 확인, 최초 기기 취소
- 예약 신청: `reserve.html` — 메뉴 선택 후 학번·이름으로 신규 예약
- 관리자 운영: `admin.html` — 1·2급 공용 예약 조회와 조리 상태 관리. 1급에는 전체 운영 기능 추가 제공
- 1급 설정: `settings.html` — 관리자 등급, 휴식시간, 행사·메뉴 설정, CSV 관리
- 데이터: Firebase 프로젝트 `jw-astro09`의 named Firestore database `reservation`
- 서버: Cloud Functions 2nd gen (`asia-northeast3`)
- 정적 배포: <https://bokseong.github.io/reservation/>

## 데이터 원칙

예약의 현재 상태는 `reservations`에 저장하고, 모든 상태 변경은 `reservationEvents`에 추가합니다. 기존 이력은 수정·삭제하지 않으며 되돌리기도 새 이벤트로 남깁니다. 고객의 원문 token은 브라우저에만 저장하고 DB에는 SHA-256 hash만 저장합니다.

## Firebase 준비

1. `jw-astro09` 프로젝트에 Firestore database ID `reservation`, location `asia-northeast3`를 production mode로 만듭니다.
2. Firebase Authentication에서 직원용 Email/Password와 Google provider를 활성화합니다.
3. Authentication 승인 도메인에 `bokseong.github.io`를 추가합니다.
4. 아래 명령으로 rules, indexes, Functions를 배포합니다.

```powershell
Set-Location C:\Users\user\Documents\ChatGPT\학교\reservation
npm.cmd --prefix functions install
npx.cmd firebase-tools@15.36.0 deploy --only firestore:rules,firestore:indexes,functions --project jw-astro09
```

## 메뉴와 Firebase SDK 설정

- 메뉴: `public/js/menu.js`의 `MENU_ITEMS`에서 `id`, `name`, `price`, `description`, `emoji`, `available`을 수정합니다.
- 메뉴 변경 후 `npm.cmd run sync:menu`를 실행하면 Functions 검증용 메뉴 파일이 갱신됩니다. `npm test`, `npm run check`, `npm run deploy:backend`는 이 동기화를 자동 실행합니다.
- Firebase Web SDK: `public/js/firebase.js`의 `firebaseConfig`에 Firebase Console의 Web App 설정을 입력합니다.
- App Check는 `bokseong.github.io`가 허용된 reCAPTCHA Enterprise(Fraud Defense) 사이트 키로 모든 페이지에서 초기화됩니다. callable Functions도 App Check token을 강제 검증합니다.

`github.jwastro09@gmail.com`은 절대 관리자입니다. Google 또는 이메일로 처음 로그인하면 `staffProfiles`에 자동 등록되며, 다른 관리자가 강등하거나 비활성화할 수 없습니다. 이후 직원 계정은 관리자 화면에서 발급합니다.

- 2급 관리자: 예약 조회, 조리 시작, 조리 완료
- 1급 관리자: 2급 기능 + 등급 변경, 휴식시간과 전체 운영 설정

고객은 Firebase 계정을 만들지 않습니다. 최초 예약 기기에만 저장되는 256-bit 무작위 token을 Functions가 검증하며, 고객 화면은 3초 간격으로 서버 상태를 동기화합니다. 직원·관리자 대기열은 Firestore realtime listener로 갱신됩니다.

## 로컬 검증

```powershell
Set-Location C:\Users\user\Documents\ChatGPT\학교\reservation
npm.cmd test
npm.cmd run check
python -m http.server 4173 --directory public
```

## 주요 컬렉션

```text
settings/event
reservations/{reservationId}
reservationEvents/{eventId}
operationEvents/{operationEventId}
staffProfiles/{uid}
counters/{counterName}
operations/{operationId}
```

`counters`와 `operations`는 Functions 전용이며 클라이언트에서 읽거나 쓸 수 없습니다.

최초 예약 기기에서 사용자가 조리 완료 푸시 알림을 허용하면 FCM token은 해당 예약의 `notificationTokens` 하위 컬렉션에만 저장됩니다. 관리자 조리 완료 처리 시에만 해당 기기로 FCM Web Push를 보냅니다. 고객 로그인은 필요하지 않습니다.
