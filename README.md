# 복성고 먹거리 부스 예약 시스템

2026 복성고 학술문화제 먹거리 부스 1곳의 예약·대기열·수령·운영 기록을 관리하는 웹 시스템입니다.

- 고객: `index.html` — 예약/복구 조회, 대기 상태 실시간 확인, 최초 기기 취소
- 직원: `staff.html` — 수령·미수령·보류·취소, 기록 되돌리기, 재료 소진
- 1급 관리자: `admin.html` — 행사 설정, 쉬는 시간, 직원 계정, 검색, CSV 3종
- 데이터: Firebase 프로젝트 `hs-bokseong`의 named Firestore database `reservation`
- 서버: Cloud Functions 2nd gen (`asia-northeast3`)
- 정적 배포: <https://bokseong.github.io/reservation/>

## 데이터 원칙

예약의 현재 상태는 `reservations`에 저장하고, 모든 상태 변경은 `reservationEvents`에 추가합니다. 기존 이력은 수정·삭제하지 않으며 되돌리기도 새 이벤트로 남깁니다. 고객의 원문 token은 브라우저에만 저장하고 DB에는 SHA-256 hash만 저장합니다.

## Firebase 준비

1. `hs-bokseong` 프로젝트에 Firestore database ID `reservation`, location `asia-northeast3`를 production mode로 만듭니다.
2. Firebase Authentication에서 Email/Password와 Anonymous provider를 활성화합니다.
3. Authentication 승인 도메인에 `bokseong.github.io`를 추가합니다.
4. 아래 명령으로 rules, indexes, Functions를 배포합니다.

```powershell
Set-Location C:\Users\user\Documents\ChatGPT\학교\reservation
npm.cmd --prefix functions install
npx.cmd firebase-tools@15.36.0 deploy --only firestore:rules,firestore:indexes,functions --project hs-bokseong
```

`github.jwastro09@gmail.com`으로 처음 관리자 로그인 시 `staffProfiles`에 bootstrap 1급 관리자 프로필이 자동 생성됩니다. 이후 직원 계정은 관리자 화면에서 발급합니다.

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
