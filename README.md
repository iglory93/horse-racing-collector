# TtingLive 경마 수집기

기존 `broadcast-live-chat-bot`에서 채팅/AI/유튜브/대시보드/명령어 처리 로직을 제거하고, 아래 흐름만 남긴 경량 수집기입니다.

1. 팅라이브 로그인
2. 라이브 채널 목록 조회
3. 각 채널 stream detail 조회로 `streamId` 확보
4. 각 채널 websocket join
5. 경마 이벤트만 수집
   - `LOTTERY_ROUND_START`
   - `FX_LOTTERY_GAME_BET`
   - `FX_LOTTERY_GAME_RESULT`
6. Firestore에 배치 기록

## 유지한 것
- 동일 Firebase 프로젝트 연결 방식
- 동일 TTING 로그인 방식
- socket.io-client 기반 실시간 수집

## 제거한 것
- 채팅 소비자/명령어/입장메시지/AI 응답
- 유튜브 연동
- 웹 대시보드/룰렛 관리 페이지
- 기프트/공지/뷰어 감시
- Firebase channels/commands/joinMessages watcher

## 수집되는 데이터
### 1) 유저 투자 랭킹
`horseRaceDaily/{yyyymmdd}/channels/{channelId}/betUsers/{userKey}`
- `nickname`
- `totalAmount`
- `betCount`
- `lastRoundId`

### 2) 말 순위 통계
`horseRaceDaily/{yyyymmdd}/channels/{channelId}/horseStats/{horseId}`
- `firstCount`
- `secondCount`
- `thirdCount`
- `raceCount`
- `firstRatio`
- `secondRatio`
- `thirdRatio`

### 3) 라운드 결과 원본
`horseRaceRounds/{channelId}_{roundId}`
- `results[]`
- `startAt`
- `gameTypeKey`

## 현재 한계
현재 확인한 `FX_LOTTERY_GAME_BET` 샘플에는 **어느 말에 베팅했는지 정보가 없음**.
그래서 지금 코드로는 아래까지만 정확하게 수집 가능합니다.
- 유저별 총 투자금 / 베팅 횟수
- 말별 1등/2등/3등 비율

반대로 아래는 **추가 이벤트가 발견돼야** 계산 가능합니다.
- 유저가 어느 말을 가장 자주 고르는지
- 말별 실제 베팅 유입액
- 적중률 / 회수율

## 실행
```bash
npm install
cp .env.example .env
npm start
```

## 성능 포인트
- live-list-main는 주기 동기화만 수행
- stream detail 조회는 제한된 동시성으로 처리
- socket 연결도 제한된 동시성으로 처리
- Firestore는 개별 이벤트마다 쓰지 않고 BulkWriter로 묶어서 flush
- 메모리 집계 후 주기 flush 구조라 전체 채널 대응에 유리

## 추가로 바로 붙일 수 있는 개선
- adult 채널 포함 옵션
- 결과/배팅 이상 감지 알림
- 채널별 최근 N라운드 메모리 캐시
- Redis 도입 시 멀티 인스턴스 샤딩
