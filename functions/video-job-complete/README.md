# @idol/video-job-complete

MediaConvert のジョブ完了 (COMPLETE / ERROR) を検知して、Web アプリの
`POST /api/admin/videos/job-complete` を叩き、対象 `Video` を
**READY / FAILED** に確定させるための通知ブリッジ Lambda です。

MediaConvert は完了を push で通知しないため、**EventBridge の
「MediaConvert Job State Change」イベント**を唯一の完了トリガーとして使い、
この Lambda が payload を整形して Web API へ転送します。

```
[MediaConvert ジョブ]
        │ 状態変化 (COMPLETE / ERROR)
        ▼
[EventBridge ルール]  source=aws.mediaconvert, detail-type="MediaConvert Job State Change"
        │
        ▼
[この Lambda]  parse-event.ts で整形 + x-cron-secret 付与
        │  POST {WEB_APP_BASE_URL}/api/admin/videos/job-complete
        ▼
[Web API]  Video を READY(+s3HlsKey) / FAILED へ更新
```

---

## 特徴 / 設計

- **軽量**: AWS SDK も Prisma も使わず、Node.js 20 の グローバル `fetch` で
  Web API を叩くだけ。ZIP は `index.js` + `index.js.map` のみ。
- **判定は純粋関数** (`src/parse-event.ts`): 単体テスト可能。
  - `COMPLETE` / `ERROR` のみ転送。中間状態 (PROGRESSING 等) は ignore。
  - `detail.userMetadata.videoId` を拾って `videoId` に載せる
    (MediaConvert ジョブ投入時に `UserMetadata: { videoId }` を付ける前提)。
  - `COMPLETE` 時は `outputGroupDetails[].outputDetails[].durationInMs` の
    最大値を秒に丸めて `durationSeconds` に載せる。
  - `ERROR` 時は `errorCode` / `errorMessage` を `errorMessage` にまとめる。
- **失敗時は throw** して Lambda を error 終了 → EventBridge のリトライ / DLQ に乗せられる。

---

## 環境変数

| 変数 | 必須 | 既定 | 説明 |
| --- | --- | --- | --- |
| `WEB_APP_BASE_URL` | ✅ | – | 例 `https://reirie.com` (末尾スラッシュ不要) |
| `CRON_SECRET` | ✅ | – | Web 側 `CRON_SECRET` と同じ値。`x-cron-secret` ヘッダに載せる |
| `JOB_COMPLETE_PATH` | – | `/api/admin/videos/job-complete` | 転送先パス |
| `REQUEST_TIMEOUT_MS` | – | `8000` | Web API 呼び出しのタイムアウト(ms) |

---

## ビルド

```bash
# 単体テスト
pnpm --filter @idol/video-job-complete test

# 型チェック
pnpm --filter @idol/video-job-complete typecheck

# バンドル (dist/index.js)
pnpm --filter @idol/video-job-complete build

# デプロイ用 ZIP (dist/function.zip)
pnpm --filter @idol/video-job-complete build:zip
```

---

## デプロイ手順 (AWS)

### 1. Lambda 関数を作成

- ランタイム: **Node.js 20.x**
- ハンドラ: `index.handler`
- コード: `dist/function.zip` をアップロード
- 環境変数: 上表の `WEB_APP_BASE_URL` / `CRON_SECRET` を設定
- タイムアウト: 15 秒程度で十分 (fetch 1 回)
- (任意) **DLQ** に SQS を設定しておくと、Web API 側の一時障害時に取りこぼしを回収できる

この Lambda は AWS リソースを操作しないため、実行ロールは基本の
`AWSLambdaBasicExecutionRole` (CloudWatch Logs 出力) のみで動きます。

### 2. EventBridge ルールを作成

デフォルトイベントバスに以下のパターンでルールを作成し、
ターゲットにこの Lambda を指定します。

```json
{
  "source": ["aws.mediaconvert"],
  "detail-type": ["MediaConvert Job State Change"],
  "detail": {
    "status": ["COMPLETE", "ERROR"]
  }
}
```

> ルール側で `status` を絞っても、本 Lambda 側でも二重に判定するので安全です。
> `status` の絞り込みを外して全状態を Lambda に流しても、中間状態は ignore されます。

CLI 例:

```bash
aws events put-rule \
  --name mediaconvert-job-complete \
  --event-pattern '{"source":["aws.mediaconvert"],"detail-type":["MediaConvert Job State Change"],"detail":{"status":["COMPLETE","ERROR"]}}'

aws lambda add-permission \
  --function-name video-job-complete \
  --statement-id eventbridge-mediaconvert \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:<region>:<account-id>:rule/mediaconvert-job-complete

aws events put-targets \
  --rule mediaconvert-job-complete \
  --targets 'Id=1,Arn=arn:aws:lambda:<region>:<account-id>:function:video-job-complete'
```

### 3. 動作確認

Lambda のテストイベントに以下を貼って invoke すると、実際に Web API を叩けます
(`WEB_APP_BASE_URL` / `CRON_SECRET` が正しく設定されている必要があります)。

```json
{
  "source": "aws.mediaconvert",
  "detail-type": "MediaConvert Job State Change",
  "detail": {
    "status": "COMPLETE",
    "jobId": "1700000000000-testjob",
    "userMetadata": { "videoId": "<実在する Video の id>" },
    "outputGroupDetails": [
      { "outputDetails": [{ "durationInMs": 123000 }] }
    ]
  }
}
```

成功すると対象 `Video` が `READY` になり、`s3HlsKey` (= `hls/<videoId>/index.m3u8`)
と `durationSeconds` が確定します。

---

## Web API 契約 (転送先)

`POST /api/admin/videos/job-complete`

- ヘッダ: `x-cron-secret: <CRON_SECRET>`
- body:
  ```jsonc
  {
    "jobId": "1700000000000-abcdef",   // 必須
    "status": "COMPLETE",              // "COMPLETE" | "ERROR"
    "videoId": "<cuid>",               // 任意 (無ければ Web 側が jobId で逆引き)
    "durationSeconds": 123,            // 任意 (COMPLETE 時)
    "errorMessage": "code=1404 ..."    // 任意 (ERROR 時)
  }
  ```

`videoId` が無い場合、Web API は `mediaConvertJob = jobId` で Video を逆引きします。

---

## 手動公開フォールバック

この Lambda / EventBridge を用意しなくても、管理画面
`/admin/videos/[id]` の **「手動で公開」** ボタンでエンコード完了後に
手動で READY 化できます。自動化する場合に本 Lambda を導入してください。
