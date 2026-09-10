# ログインボーナス API 仕様（スマホアプリ向け）

7 日スタンプカードに各日の獲得額を表示するため、既存の
`GET/POST /api/me/login-bonus` にフィールドを追加しました。

**既存フィールドはそのまま残しています**（後方互換）。Web 版・現行アプリは影響を受けません。

---

## ⚠️ 最初にお読みください：想定されていた値と実装が違いました

ご要望に例として挙げられていた `schedule` は次の値でした。

```js
"schedule": [10, 10, 10, 20, 20, 20, 50]   // ← ご要望の想定
```

しかし**実際の付与ロジックはこうなっていません**。実装は

- 毎日 `loginBonusBase`（既定 **10**）
- `loginStreakThreshold`（既定 **7**）の倍数の日に `loginStreakBonus`（既定 **50**）を**上乗せ**

なので、実際は次の値になります。

```js
"schedule": [10, 10, 10, 10, 10, 10, 60]   // ← 実際（FREE 会員）
```

途中の日が段階的に増えることはなく、**7 日目だけ跳ね上がる**形です。

### さらに：金額はプランで変わります

付与時にプラン倍率がかかります。

| プラン | 倍率 | schedule |
|---|---|---|
| FREE | ×1.0 | `[10,10,10,10,10,10,60]` |
| STANDARD | ×1.2 | `[12,12,12,12,12,12,72]` |
| PREMIUM | ×2.0 | `[20,20,20,20,20,20,120]` |

### 🔴 したがって、アプリ側で固定値を持たないでください

- 管理画面から `base` / `streakBonus` / `threshold` を**変更できます**
- 会員のプランによって**金額が変わります**

固定値を持つと「**表示は 20 なのに実際は 10 しか増えない**」という状態になり、
ユーザーの不信につながります。必ず API が返す `schedule` / `nextAmount` を使ってください。

---

## GET /api/me/login-bonus

今日の受給状況とスタンプカード情報を取得します。

```http
GET /api/me/login-bonus
Authorization: Bearer <accessToken>
```

### レスポンス例（FREE 会員・6 日連続・今日は未受取）

```json
{
  "date": "2026-09-10",
  "claimedToday": false,
  "streak": 6,
  "amount": 0,
  "balance": 168,

  "schedule": [10, 10, 10, 10, 10, 10, 60],
  "nextAmount": 60,
  "cycleLength": 7,
  "cyclePosition": 7,
  "days": [
    { "day": 1, "amount": 10, "isMilestone": false, "state": "claimed" },
    { "day": 2, "amount": 10, "isMilestone": false, "state": "claimed" },
    { "day": 3, "amount": 10, "isMilestone": false, "state": "claimed" },
    { "day": 4, "amount": 10, "isMilestone": false, "state": "claimed" },
    { "day": 5, "amount": 10, "isMilestone": false, "state": "claimed" },
    { "day": 6, "amount": 10, "isMilestone": false, "state": "claimed" },
    { "day": 7, "amount": 60, "isMilestone": true,  "state": "today"   }
  ],
  "plan": "FREE",
  "planMultiplier": 1
}
```

### フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| **既存** | | |
| `date` | string | 今日の日付（JST, `YYYY-MM-DD`） |
| `claimedToday` | boolean | 今日受け取ったか |
| `streak` | number | 連続ログイン日数 |
| `amount` | number | 今日受け取った額（未受取なら `0`） |
| `balance` | number | 現在の Pui 残高 |
| **追加** | | |
| `schedule` | number[] | 1〜N 日目の付与額（**プラン倍率適用後**） |
| `nextAmount` | number | 今日受け取れる額。受取済みなら**次回**の額 |
| `cycleLength` | number | サイクル長（既定 `7`）。**この数だけマスを描いてください** |
| `cyclePosition` | number | サイクル内の現在位置（`1`〜`cycleLength`） |
| `days` | object[] | スタンプカード表示用の詳細（下記） |
| `plan` | string | `FREE` / `STANDARD` / `PREMIUM` |
| `planMultiplier` | number | 適用倍率（`2` なら 2 倍） |

### `days[]` の各要素

| フィールド | 型 | 説明 |
|---|---|---|
| `day` | number | サイクル内の日番号（1 始まり） |
| `amount` | number | その日の付与額（プラン倍率適用後） |
| `isMilestone` | boolean | 連続ボーナスが上乗せされる節目の日 |
| `state` | string | `claimed`（受取済み）/ `today`（今日受け取れる）/ `upcoming`（未来） |

> 💡 `state` を見れば、スタンプの塗り分けがそのままできます。
> `isMilestone` が `true` の日を強調すると「7 日目は 60 Pui!」と訴求できます。

---

## POST /api/me/login-bonus

ログインボーナスを受け取ります。

```http
POST /api/me/login-bonus
Authorization: Bearer <accessToken>
```

### レスポンス例（受取成功）

```json
{
  "granted": true,
  "alreadyGranted": false,
  "amount": 60,
  "streak": 7,
  "balance": 238,

  "date": "2026-09-10",
  "schedule": [10, 10, 10, 10, 10, 10, 60],
  "nextAmount": 10,
  "cycleLength": 7,
  "cyclePosition": 7,
  "days": [ /* 全て state: "claimed" */ ],
  "plan": "FREE",
  "planMultiplier": 1
}
```

| フィールド | 説明 |
|---|---|
| `granted` | 受け取れたか |
| `alreadyGranted` | 既に今日受け取っていた場合 `true`（`granted` は `false`） |
| `amount` | 実際に付与された額 |

> **POST 後に GET を呼び直す必要はありません。**
> スタンプカードの更新に必要な情報（`days` / `nextAmount` など）を同じ形で返します。

### 二重受取について

同日に 2 回呼んでも二重付与されません（`userId + date` の UNIQUE 制約）。
2 回目は `granted: false, alreadyGranted: true` が返ります。

---

## 実装のヒント

### 「明日は 60 Pui!」を出す

受取済み（`claimedToday: true`）のとき、`nextAmount` は**次回の額**になります。

```
if (claimedToday && nextAmount > schedule[0]) {
  → 「明日は ★{nextAmount} Pui!」と表示して翌日の再訪を促せます
}
```

### 節目の強調

```
days.filter(d => d.isMilestone)   // 通常は 7 日目のみ
```

### プラン訴求

`planMultiplier` が `1`（FREE）のとき、
「PREMIUM なら 2 倍もらえます」という導線を出せます。

---

## 検証済みの動作

ローカル環境で実データを使い、次を確認済みです。

| ケース | 結果 |
|---|---|
| 未受取・初回 | `cyclePosition: 1` / `nextAmount: 10` / 1 日目が `today` |
| 6 日連続・未受取 | `cyclePosition: 7` / `nextAmount: 60` / 7 日目が `today` |
| **予告額と実付与額の一致** | 予告 `60` → POST で `amount: 60` ✅ |
| 節目受取後 | 全て `claimed` / `nextAmount: 10`（次サイクル 1 日目） |
| PREMIUM 会員 | `schedule: [20,...,120]` / POST で `amount: 20` ✅ |
| レート設定変更 | `threshold: 3` にすると `cycleLength: 3` に追従 |
| 認証 | 未認証は `401` / Bearer・Cookie 両方で `200` |
| 後方互換 | 既存 5 フィールドすべて維持・Web 版 `/me` も正常 |

---

## 関連

- 全体の API 一覧: `docs/api/mobile-api.md`
- 付与ロジック本体: `apps/web/src/lib/points.ts` の `grantLoginBonus`
- 金額計算: `packages/shared/src/membership.ts` の `computeLoginBonusAmount`
- スケジュール組み立て: `packages/shared/src/login-bonus-app.ts`
