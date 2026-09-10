# 1on1 チケット API 仕様（スマホアプリ向け）

`GET /api/call/tickets/me` — **自分の「まだ有効な」1on1 チケット一覧**

---

## 1. これで何が解決するか

ご指摘いただいた問題はそのとおりでした。

> シリアル引換後にアプリを閉じると、待機室へ戻る手段がありません
> （コード再入力は「使用済み」エラーになる可能性）。
> 通知タップからは戻れますが、**通知を許可していない人は詰みます**。

実装を確認したところ、確かに **引換済みチケットを引く手段がありませんでした**。
待機列の状態は SSE（`/api/call/events/{id}/queue/events`）で取れますが、
これは **イベント ID を既に知っている前提**の API です。
アプリを開き直した直後は、その ID を持っていません。

この API は「**自分がいまどのイベントのチケットを持っているか**」を返します。
これでホームのバナーを次のように自動で振り分けられます。

| 条件 | バナーの挙動 |
|---|---|
| 有効なチケットがある | 待機室へ直行（`waitingRoomPath` を開く） |
| 無い | シリアル入力画面へ |

そのための判定は **`bannerAction` フィールドで返しています**（後述）。
アプリ側で件数を数える必要はありません。

---

## 2. エンドポイント

```http
GET /api/call/tickets/me
Authorization: Bearer <accessToken>
```

- **認証**: 会員必須。Bearer トークン / Cookie セッションの両方に対応
- **未認証**: `401 { "error": { "code": "UNAUTHORIZED", "message": "ログインが必要です" } }`
- **キャッシュ**: `Cache-Control: no-store`（待機列は刻々と変わるため）
- **上限**: 最大 20 件（1 人が同時に大量のチケットを持つことは運用上ありません）

---

## 3. レスポンス

```json
{
  "tickets": [
    {
      "id": "cccccccc-0000-4000-8000-000000000001",
      "eventId": "aaaaaaaa-0000-4000-8000-000000000001",
      "queuePos": 4,
      "status": "WAITING",
      "aheadCount": 2,
      "enteredWaitingAt": null,
      "enteredMainAt": null,
      "canEnterWaitingRoom": true,
      "waitingRoomPath": "/call/events/aaaaaaaa-0000-4000-8000-000000000001/waiting",
      "event": {
        "id": "aaaaaaaa-0000-4000-8000-000000000001",
        "title": "TEST84 LIVE イベント",
        "startsAt": "2026-09-10T08:22:11.363Z",
        "endsAt": "2026-09-10T10:32:11.363Z",
        "status": "LIVE",
        "perFanSeconds": 90,
        "noticeText": "スマホの方は充電をお願いします"
      }
    }
  ],
  "bannerAction": "enter_waiting"
}
```

チケットが 1 件も無いときは次のようになります。

```json
{ "tickets": [], "bannerAction": "redeem" }
```

### フィールド一覧

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string (UUID) | チケット ID |
| `eventId` | string (UUID) | イベント ID |
| `queuePos` | number | 引換順（1 始まり）。**「あと何人」ではありません**（下記注意） |
| `status` | enum | `WAITING` / `IN_WAITING_ROOM` / `IN_MAIN_ROOM` |
| `aheadCount` | number | **自分の前に残っている人数**。表示にはこちらを使ってください |
| `enteredWaitingAt` | string \| null | 待機室に入った時刻（ISO8601 / UTC） |
| `enteredMainAt` | string \| null | 本ルーム（通話）に入った時刻 |
| `canEnterWaitingRoom` | boolean | いま待機室に入れるか。`event.status === "LIVE"` のときだけ `true` |
| `waitingRoomPath` | string | 待機室のパス。アプリはこれをそのまま開けます |
| `event.title` | string | イベント名 |
| `event.startsAt` | string | 開始日時（ISO8601 / UTC）。「本日 20:00 開始」の表示用 |
| `event.endsAt` | string \| null | 終了予定日時 |
| `event.status` | enum | `SCHEDULED` / `LIVE` |
| `event.perFanSeconds` | number | 1 人あたりの持ち時間（秒）。待ち時間の概算に使えます |
| `event.noticeText` | string \| null | 運営からの注意書き |
| `bannerAction` | `"enter_waiting"` \| `"redeem"` | ホームバナーの分岐用 |

---

## 4. ⚠️ `queuePos` を「あと何人」に使わないでください

ここが一番間違えやすいところです。

`queuePos` は **引換順に振られた固定の番号**で、進行に応じて減りません。
`queuePos - 1` を「あと何人」として表示すると、**Web の待機室画面と数字がズレます**。

実際に検証した例です。

| queuePos | 状態 |
|---|---|
| 1 | `IN_MAIN_ROOM`（いま通話中） |
| 2 | `IN_WAITING_ROOM` |
| 3 | `WAITING` |
| **4** | **自分（`WAITING`）** |

このとき

- `queuePos - 1` = **3**（誤り）
- `aheadCount` = **2**（正しい）

通話中の人（`IN_MAIN_ROOM`）は「自分の前に待っている人」ではないため数えません。
`aheadCount` はこの定義で計算しています。

```sql
-- 実装上の定義
COUNT(*) WHERE eventId = 自分のイベント
             AND queuePos < 自分のqueuePos
             AND status IN ('WAITING', 'IN_WAITING_ROOM')
```

これは **待機室 SSE（`/api/call/events/{id}/queue/events`）が返す `me.aheadCount` と同じ式**です。
実際に同じ状況で両方を叩いて `2` / `2` で一致することを確認済みです。
別々に計算するとバナーと待機室で数字が食い違うため、**必ず `aheadCount` を使ってください**。

---

## 5. 何が「有効」なのか

次の**両方**を満たすものだけ返します。

- チケットの `status` が `DONE` / `NO_SHOW` **以外**
- イベントの `status` が `ENDED` / `CANCELED` **以外**

結果として、返りうる組み合わせは次の 6 通りです。

| ticket \ event | SCHEDULED | LIVE | ENDED | CANCELED |
|---|---|---|---|---|
| WAITING | ✅ | ✅ | ✖ | ✖ |
| IN_WAITING_ROOM | ✅ | ✅ | ✖ | ✖ |
| IN_MAIN_ROOM | ✅ | ✅ | ✖ | ✖ |
| DONE | ✖ | ✖ | ✖ | ✖ |
| NO_SHOW | ✖ | ✖ | ✖ | ✖ |

### `IN_MAIN_ROOM` を含めている理由

ご要望は「`DONE`/`NO_SHOW` 以外」でしたので仕様どおりですが、
意図を明示しておきます。

**通話中に回線が切れてアプリを開き直した人** は `IN_MAIN_ROOM` のままです。
これはまさに「戻りたい」状態なので、除外すると
**通話中の事故から復帰できなくなります**。有効として扱ってください。

---

## 6. 並び順

サーバー側で「復帰させたい順」に並べて返します。アプリ側での並べ替えは不要です。

1. **チケット状態**：`IN_MAIN_ROOM` → `IN_WAITING_ROOM` → `WAITING`
   （通話中＝いますぐ戻すべき人を最優先）
2. **イベント状態**：`LIVE` → `SCHEDULED`
3. **開始日時**の昇順

`tickets[0]` を見れば「いま案内すべきチケット」になります。

---

## 7. アプリ側の実装例

```ts
const res = await fetch(`${BASE}/api/call/tickets/me`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});

if (res.status === 401) {
  // 未ログイン → ログイン画面へ
  return;
}

const { tickets, bannerAction } = await res.json();

if (bannerAction === 'redeem') {
  showBanner({ label: '1ON1 CALL', onTap: openSerialInput });
  return;
}

const t = tickets[0];

if (!t.canEnterWaitingRoom) {
  // まだ SCHEDULED。開始を待ってもらう
  showBanner({
    label: `${formatJst(t.event.startsAt)} 開始`,
    sub: t.event.title,
    onTap: () => showDialog('開始までお待ちください'),
  });
  return;
}

showBanner({
  label: t.status === 'IN_MAIN_ROOM' ? '通話に戻る' : `あと ${t.aheadCount} 人`,
  sub: t.event.title,
  onTap: () => openWaitingRoom(t.eventId),   // t.waitingRoomPath でも可
});
```

### 呼ぶタイミング

- アプリ起動時 / フォアグラウンド復帰時
- シリアル引換に成功した直後
- プッシュ通知をタップして復帰したとき

待機列のリアルタイム更新は従来どおり
`GET /api/call/events/{id}/queue/events`（SSE）を使ってください。
この API は**ポーリング用ではありません**（入口を見つけるための API です）。

---

## 8. 検証済みの挙動

実際にテスト環境で確認した結果です。

| 検証項目 | 結果 |
|---|---|
| 未認証 | `401 UNAUTHORIZED` |
| Bearer トークン | `200`（2 件） |
| Cookie セッション | `200`（2 件・Bearer と一致） |
| チケット `WAITING` / `IN_WAITING_ROOM` / `IN_MAIN_ROOM` | 返る |
| チケット `DONE` / `NO_SHOW` | 返らない |
| イベント `SCHEDULED` | 返る・`canEnterWaitingRoom: false` |
| イベント `LIVE` | 返る・`canEnterWaitingRoom: true` |
| イベント `ENDED` / `CANCELED` | 返らない |
| `aheadCount` と SSE `me.aheadCount` | `2` / `2` で一致 |
| 有効チケット 0 件 | `{ "tickets": [], "bannerAction": "redeem" }` |
| 並び順（`IN_MAIN_ROOM` を先頭に） | 期待どおり |

判定ロジックは `packages/shared/src/call-ticket-active.ts` に切り出し、
**21 件のユニットテスト**で固定しています。
