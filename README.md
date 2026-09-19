# notveryordinarymahjong

작혼(雀魂) 스타일의 4인 일본 리치마작 웹 게임입니다. 규칙 엔진은 프레임워크에 의존하지 않는
TypeScript 라이브러리로 분리되어 있고, 같은 엔진을 브라우저(혼자 연습)와
Colyseus 서버(온라인 대전)에서 함께 사용합니다.

## 구성

| 패키지 | 설명 |
| --- | --- |
| `packages/shared` | 패·벽패·샹텐·화료형·점수 계산과 국/대국 상태 머신, 봇 AI |
| `packages/server` | `@colyseus/core` 기반 게임 서버 + 빌드된 클라이언트 정적 서빙 |
| `packages/client` | React 19 + Vite 클라이언트 (패 렌더링, 탁자 UI, 솔로/온라인 컨트롤러) |

## 요구 사항

- Node.js 20 이상 (npm workspaces 사용)

## 설치

```bash
npm install
```

## 실행 방법

### 개발 모드

```bash
npm run dev
```

`shared`를 먼저 빌드한 뒤 게임 서버(`http://localhost:2567`)와
Vite 개발 서버(`http://localhost:5173`)를 동시에 띄웁니다.
브라우저에서 <http://localhost:5173> 을 열면 됩니다.

개별 실행도 가능합니다.

```bash
npm run build:shared   # 서버가 참조하는 @mahjong/shared 빌드
npm run dev:server     # 게임 서버만
npm run dev:client     # 클라이언트만
```

개발 모드의 클라이언트는 `http://<현재 호스트>:2567` 을 게임 서버로 사용합니다.
다른 주소를 쓰려면 `packages/client/.env.local` 에 다음을 지정하세요.

```bash
VITE_SERVER_URL=http://192.168.0.10:2567
```

### 프로덕션 실행

```bash
npm run build   # shared → server → client 순서로 빌드
npm start       # http://localhost:2567 에서 매칭·웹소켓·클라이언트를 모두 서빙
```

`PORT` 환경 변수로 포트를 바꿀 수 있습니다.

### 검사

```bash
npm test        # 규칙 엔진 단위 테스트 (vitest)
npm run typecheck
```

## 플레이 모드

- **혼자 연습** — 서버 없이 브라우저 안에서 엔진을 그대로 돌리고 나머지 3자리는 봇이 채웁니다.
- **서버 대전** — Colyseus 방에 접속합니다. 빈 자리는 봇이 채우며, 사람이 나가면
  그 자리는 봇이 이어서 플레이합니다. 접속이 끊겨도 2분 안에 돌아오면 자리를 유지합니다.
  사람의 제한 시간은 턴 18초 / 울기 10초이며, 시간이 지나면 쯔모기리 또는 패스로 자동 처리됩니다.

## 구현된 규칙

기본값은 천봉/작혼에 가까운 설정이며 `RuleConfig`(`packages/shared/src/rules.ts`)로 전부 조정할 수 있습니다.

### 대국 진행

- 동남전(반장전) 기본, 동풍전(`length: "east"`) 선택 가능
- 시작점 25,000 / 반환점 30,000, 우마 `+15 / +5 / -5 / -15`
- 친 연장(렌창), 연장전(서든데스, 최대 12국), 오라스 아가리야메, 도비(하코) 종료
- 혼바(본장) 300점, 리치봉 적립과 승자 회수(대국 종료 시 1위가 회수)

### 손패와 행동

- 쯔모 · 론 · 치 · 퐁 · 대명깡 · 가깡 · 안깡
- 리치 / 더블리치 / 일발, 리치 시 1,000점 이상 필요, 리치 후 안깡은 대기가 변하지 않을 때만 허용
- 후리텐(영구 · 일시 · 리치 후) 처리와 론 견제 시 자동 적용
- 적도라 3장(5만·5통·5삭 각 1장), 뒷도라, 깡도라(안깡은 즉시, 가깡·대명깡은 버림 후 공개)
- 쿠이탕(먹탕) 허용, 영상개화 · 창깡(국사무쌍의 안깡 창깡 포함) 처리
- 역이 없으면 화료 불가(야쿠나시 검사)

### 유국 · 연장

- 황패평국(노텐 벌부 3,000점 분배), 나가시 만관
- 구종구패 · 사풍연타 · 사가리치 · 사개깡 · 삼가화(3인 동시 론)
- 두 명이 론하면 기본은 다론(더블 론), `atamahane: true`로 머리하네(두방)로 전환

### 점수 계산

- 판/부 계산 후 만관 · 하네만 · 배만 · 삼배만 · 역만, 다중 역만(`doubleYakuman`) 지원
- 역 이름은 한국어로 현지화되어 결과창과 로그에 표시됩니다(`packages/shared/src/yakuNames.ts`)

## 코드 메모

- `packages/shared/src/engine.ts` — 국 진행 상태 머신(`MahjongGame`). 합법 수는
  `turnOptions()` / `callOptions()` 가 제공하고 `apply(seat, action)` 로 적용합니다.
- `packages/shared/src/view.ts` — 좌석별로 공개 정보만 남긴 `PlayerView` 생성과 이벤트 마스킹.
- `packages/shared/src/bot.ts` — 샹텐 기반의 간단한 봇.
- `packages/client/src/game/useSoloGame.ts` — 브라우저 안에서 엔진과 봇을 돌리는 훅.
- `packages/client/src/game/useOnlineGame.ts` — Colyseus 방 연결 훅.

## 라이선스

MIT
