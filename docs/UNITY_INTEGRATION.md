# Unity / モバイルアプリ 連携ガイド

このドキュメントは、将来 Web 版のミニゲームやその他の会員向け機能を
**Unity (ネイティブ / WebGL) やスマホアプリに移行・並行提供**する際に、
既存のバックエンド (Next.js API) をそのまま引き継ぐための手引きです。

Web 版とまったく同じ API・同じサーバーロジック (勝敗判定・ポイント付与・不正対策) を
Unity / モバイルアプリから利用できます。クライアント側で実装するのは「画面と入力」だけです。

> 2026年7月時点では、あっち向いてホイ用のバージョン付き `/api/v1/*` に加えて、
> **Web が使っている既存 API のほぼすべて**が Bearer トークンで呼べるようになっています
> (詳細は §3.2)。ミニゲーム以外の機能 (プロフィール・注文・チケット・通話など) を
> モバイルアプリに実装する場合はこちらも参照してください。

---

## 1. 設計の前提

- **サーバー権威 (Server-authoritative)**: じゃんけんの CPU の手、方向、勝敗、ポイント付与は
  すべてサーバーが確定します。クライアントは「自分の手」と「方向」しか送りません。
  → Unity 側を改造してもポイントを不正に増やすことはできません。
- **認証は 2 方式に対応**:
  - Web ブラウザ … Cookie セッション (Auth.js)
  - Unity / モバイル … **Bearer トークン** (`Authorization: Bearer <accessToken>`)
- **API はバージョン付き** (`/api/v1/...`)。破壊的変更時は `/api/v2` を追加し、v1 を維持します。

---

## 2. 認証フロー

```
[Unity] POST /api/v1/auth/token  {email, password}
        ─────────────────────────────▶
        ◀─ {accessToken, refreshToken, expiresIn, user}

[Unity] 以後すべての API 呼び出しに
        Authorization: Bearer <accessToken>

  accessToken が切れたら (401 / expiresIn 経過):
[Unity] POST /api/v1/auth/token/refresh  {refreshToken}
        ◀─ 新しい {accessToken, refreshToken}
```

- `accessToken`: 短命 (既定 1 時間)。API 呼び出しに使う。
- `refreshToken`: 長命 (既定 30 日)。`accessToken` の再発行に使う。
- トークンは Unity の安全な場所 (`PlayerPrefs` は簡易。可能なら OS のセキュアストレージ) に保存。

---

## 3. エンドポイント一覧

### 3.1 `/api/v1/*` (バージョン付き・クライアント非依存)

| メソッド | パス | 説明 | 認証 |
|---|---|---|---|
| POST | `/api/v1/auth/token` | email+password でトークン発行 | 不要 |
| POST | `/api/v1/auth/token/refresh` | access トークン再発行 | refresh トークン |
| GET  | `/api/v1/auth/me` | 自分の情報・ポイント残高 | Bearer |
| GET  | `/api/v1/games/acchi` | 本日の残り回数・残高 | Bearer / Cookie |
| POST | `/api/v1/games/acchi` | あっち向いてホイを 1 回プレイ | Bearer / Cookie |
| POST | `/api/v1/games/acchi/buy-extra-play` | 追加プレイ権を Fan ポイントで購入 | Bearer / Cookie |

> `/api/v1/games/acchi*` は `/api/me/games/acchi*` (3.2) と**サーバーロジックを完全に共有**しています
> (`apps/web/src/lib/games/acchi-handlers.ts`)。どちらの URL を呼んでも挙動・レスポンスは同一です。
> Unity 側は当面 `/api/v1/...` を使い続けてください (バージョン付き URL の後方互換を維持するため)。

### 3.2 その他すべての Web API (`/api/me/*`, `/api/contents/*`, `/api/game/*`, `/api/tickets/*` など)

2026年7月のアップデートで、**Web フロントエンドが使っている既存 API のほぼすべて**が
`/api/v1/*` と同様に Bearer トークンでも呼べるようになりました。
新しい `/api/v2` を待たずに、以下の URL を Unity / モバイルアプリからそのまま利用できます。

- `GET/POST /api/me/*` (プロフィール、ポイント、DM、注文履歴、リワード交換など)
- `GET /api/contents/*`, `POST /api/contents/comments`
- `GET/POST /api/game/*` (進行状況、セーブスロット、購入、ギフト)
- `GET/POST /api/tickets/*`, `/api/live/*`, `/api/videos/*`, `/api/subscriptions/*`, `/api/orders/*`, `/api/cart/*`
- `GET/POST /api/call/*` (通話イベント・シグナリング・待機列)

対応状況・パラメータの詳細は `docs/openapi.yaml` の各エンドポイントの `security` 欄
(`bearerAuth` が付いているもの)を参照してください。認証方式は
`Authorization: Bearer <accessToken>` ヘッダを付けるだけで、Web と同じレスポンス形式が返ります。

> ⚠️ 管理者向け `/api/admin/*` `/api/super-admin/*` は対象外です (ADMIN/SUPER_ADMIN ロール専用、
> ネイティブアプリからの利用は想定していません)。

### 3.3 SSE (Server-Sent Events) を Bearer で使う場合

`EventSource` (ブラウザ標準 API、あるいは Unity 側の SSE クライアントライブラリ) は
カスタムヘッダ (`Authorization`) を送れません。そのため、SSE エンドポイント
(例: `/api/call/events/[id]/queue/events` の待機列リアルタイム更新) は
クエリパラメータ `?access_token=<accessToken>` でも Bearer トークンを受け付けます。

```
GET /api/call/events/{id}/queue/events?access_token=<accessToken>
```

`Authorization` ヘッダとクエリパラメータのどちらでも認証できますが、
ヘッダを付けられる通常の HTTP リクエストでは **ヘッダ方式を優先**してください
(URL やログにトークンが残る `access_token` クエリは SSE 専用の代替手段です)。

詳細なリクエスト/レスポンス形式は `docs/openapi.yaml` を参照 (Swagger UI 等で閲覧可)。

### あっち向いてホイ プレイ
リクエスト:
```json
{ "hand": "ROCK", "direction": "UP" }
```
- `hand`: `ROCK` | `SCISSORS` | `PAPER`
- `direction`: `UP` | `DOWN` | `LEFT` | `RIGHT`

レスポンス:
```json
{
  "janken":   { "player": "ROCK", "cpu": "SCISSORS", "outcome": "WIN" },
  "direction":{ "player": "UP", "cpu": "UP" },
  "result": "WIN",
  "reward": 30,
  "balance": 130,
  "playedToday": 1,
  "remaining": 4
}
```
- `result`: `WIN`(勝ち=報酬) / `LOSE`(負け) / `DRAW`(勝負つかず)
- 本日の上限 (5 回) に達していると HTTP `429` が返ります。

---

## 4. Unity C# 実装例 (UnityWebRequest)

```csharp
using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

public static class ApiConfig
{
    public const string BaseUrl = "https://example.com"; // 本番ドメインに変更
    public static string AccessToken;
    public static string RefreshToken;
}

[Serializable] public class LoginRequest { public string email; public string password; }
[Serializable] public class TokenResponse {
    public string accessToken; public string refreshToken; public string tokenType; public int expiresIn;
}
[Serializable] public class PlayRequest { public string hand; public string direction; }
[Serializable] public class JankenInfo { public string player; public string cpu; public string outcome; }
[Serializable] public class DirInfo { public string player; public string cpu; }
[Serializable] public class PlayResponse {
    public JankenInfo janken; public DirInfo direction;
    public string result; public int reward; public int balance; public int playedToday; public int remaining;
}

public class AcchiApiClient : MonoBehaviour
{
    // --- ログイン ---
    public IEnumerator Login(string email, string password, Action<bool> done)
    {
        var body = JsonUtility.ToJson(new LoginRequest { email = email, password = password });
        using var req = MakeJsonPost($"{ApiConfig.BaseUrl}/api/v1/auth/token", body, withAuth:false);
        yield return req.SendWebRequest();
        if (req.result != UnityWebRequest.Result.Success) { done?.Invoke(false); yield break; }
        var res = JsonUtility.FromJson<TokenResponse>(req.downloadHandler.text);
        ApiConfig.AccessToken = res.accessToken;
        ApiConfig.RefreshToken = res.refreshToken;
        done?.Invoke(true);
    }

    // --- リフレッシュ ---
    public IEnumerator Refresh(Action<bool> done)
    {
        var body = "{\"refreshToken\":\"" + ApiConfig.RefreshToken + "\"}";
        using var req = MakeJsonPost($"{ApiConfig.BaseUrl}/api/v1/auth/token/refresh", body, withAuth:false);
        yield return req.SendWebRequest();
        if (req.result != UnityWebRequest.Result.Success) { done?.Invoke(false); yield break; }
        var res = JsonUtility.FromJson<TokenResponse>(req.downloadHandler.text);
        ApiConfig.AccessToken = res.accessToken;
        ApiConfig.RefreshToken = res.refreshToken;
        done?.Invoke(true);
    }

    // --- プレイ (401 のとき自動リフレッシュして 1 回だけ再試行) ---
    public IEnumerator Play(string hand, string direction, Action<PlayResponse> done)
    {
        yield return PlayInternal(hand, direction, true, done);
    }

    IEnumerator PlayInternal(string hand, string direction, bool retryOn401, Action<PlayResponse> done)
    {
        var body = JsonUtility.ToJson(new PlayRequest { hand = hand, direction = direction });
        using var req = MakeJsonPost($"{ApiConfig.BaseUrl}/api/v1/games/acchi", body, withAuth:true);
        yield return req.SendWebRequest();

        if (req.responseCode == 401 && retryOn401)
        {
            bool ok = false;
            yield return Refresh(r => ok = r);
            if (ok) { yield return PlayInternal(hand, direction, false, done); yield break; }
        }
        if (req.responseCode == 429) { Debug.Log("本日の上限に達しました"); done?.Invoke(null); yield break; }
        if (req.result != UnityWebRequest.Result.Success) { done?.Invoke(null); yield break; }

        var res = JsonUtility.FromJson<PlayResponse>(req.downloadHandler.text);
        done?.Invoke(res);
    }

    // --- 共通: JSON POST リクエスト生成 ---
    static UnityWebRequest MakeJsonPost(string url, string json, bool withAuth)
    {
        var req = new UnityWebRequest(url, "POST");
        req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
        req.downloadHandler = new DownloadHandlerBuffer();
        req.SetRequestHeader("Content-Type", "application/json");
        if (withAuth && !string.IsNullOrEmpty(ApiConfig.AccessToken))
            req.SetRequestHeader("Authorization", "Bearer " + ApiConfig.AccessToken);
        return req;
    }
}
```

使用例:
```csharp
StartCoroutine(client.Login("user@example.com", "password", ok => {
    if (!ok) { /* ログイン失敗表示 */ return; }
    StartCoroutine(client.Play("ROCK", "UP", res => {
        if (res == null) return;          // 上限 or エラー
        if (res.result == "WIN") ShowWin(res.reward, res.balance);
        else if (res.result == "LOSE") ShowLose();
        else ShowDraw();
        UpdateRemaining(res.remaining);
    }));
}));
```

> 注: `Newtonsoft.Json` を使うとネストした JSON のマッピングがより堅牢です。
> `JsonUtility` でも上記の `[Serializable]` クラス構成で動作します。

---

## 5. 本番運用で必要な設定 (環境変数)

| 変数 | 説明 | 既定 |
|---|---|---|
| `AUTH_SECRET` | トークン署名鍵 (必須・強いランダム値) | dev 用ダミー |
| `API_TOKEN_SECRET` | トークン専用に鍵を分けたい場合 (任意) | `AUTH_SECRET` を流用 |
| `API_TOKEN_ISSUER` | iss クレーム | `reirie-funsite` |
| `API_TOKEN_AUDIENCE` | aud クレーム | `reirie-api` |
| `API_TOKEN_ACCESS_TTL_SEC` | access 有効秒数 | `3600` (1h) |
| `API_TOKEN_REFRESH_TTL_SEC` | refresh 有効秒数 | `2592000` (30d) |

---

## 6. WebGL ビルドの場合の注意 (CORS)

- Unity を **WebGL** でビルドして別ドメインから API を叩く場合は、サーバーに CORS 設定が必要です
  (ネイティブ iOS/Android ビルドでは不要)。
- 必要になったタイミングで、`/api/v1/*` に対する CORS ヘッダ (許可オリジン) を追加します。
  この PR の時点では未設定です (ネイティブ前提)。

---

## 7. 移行時のチェックリスト

- [ ] `AUTH_SECRET` を本番で強い値に設定済み
- [ ] Unity 側にトークンの保存・自動リフレッシュを実装
- [ ] 401 → refresh → 再試行のリトライを実装
- [ ] 429 (上限到達) の UI を実装
- [ ] (WebGL の場合) CORS 設定を追加
- [ ] 新しいゲームを足す場合も「サーバーで結果確定」を厳守
- [ ] ミニゲーム以外の機能を実装する場合は §3.2 の対応エンドポイント一覧と
      `docs/openapi.yaml` の `security` 欄 (`bearerAuth`) を確認
- [ ] SSE (リアルタイム更新) を使う場合は §3.3 の `?access_token=` クエリ方式を利用
