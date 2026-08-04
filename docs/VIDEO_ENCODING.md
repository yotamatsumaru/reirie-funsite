# 動画エンコード (MediaConvert + HLS) セットアップ手順

管理画面 `/admin/videos/new` で **「MediaConvert が未設定です」** と表示される場合の
設定手順書です。

## 全体構成

```
[管理者] 動画ファイル
    │ ① 署名付き PUT (/api/admin/videos/upload-url)
    ▼
[S3_VIDEO_BUCKET] source/YYYY/MM/<uuid>/<filename>   ← アップロード受け口 (非公開)
    │ ② MediaConvert CreateJob (/api/admin/videos/[id]/encode)
    │    Role = MEDIACONVERT_ROLE_ARN
    ▼
[S3_MEDIA_OUTPUT_BUCKET] hls/<videoId>/index.m3u8 + *.ts + thumbnail.*.jpg
    │ ③ EventBridge → video-job-complete Lambda
    │    POST /api/admin/videos/job-complete (x-cron-secret)
    │    → Video を READY 化 (s3HlsKey / thumbnailUrl / durationSeconds 確定)
    ▼
[CloudFront: CLOUDFRONT_VIDEO_DOMAIN]  ← オリジンは **出力バケット**
    │ ④ 署名付き URL (/api/videos/[id]/playback)
    ▼
[会員のブラウザ]  hls.js でプラン別画質に制限して再生
```

> **重要**: CloudFront 動画ディストリビューションのオリジンは
> **出力バケット (`S3_MEDIA_OUTPUT_BUCKET`)** です。
> HLS をアップロード受け口バケットに出力すると、CloudFront から参照できず
> 再生時に 403/404 になります。

---

## 必要な環境変数

### エンコード実行に必須（これが無いと「未設定です」表示になる）

| 変数 | 説明 |
| --- | --- |
| `S3_VIDEO_BUCKET` | アップロード受け口バケット（MediaConvert の入力元） |
| `S3_MEDIA_OUTPUT_BUCKET` | HLS 出力先バケット。未設定時は `S3_VIDEO_BUCKET` にフォールバック |
| `MEDIACONVERT_ROLE_ARN` | **MediaConvert が引き受ける IAM ロール ARN** |
| `AWS_REGION` | 既定 `ap-northeast-1` |

`MEDIACONVERT_ROLE_ARN` は「ジョブ投入元 (EC2) の権限」とは別物です。
MediaConvert はジョブに指定されたロールを自分で引き受けて S3 を読み書きするため、
**このロールが無いと CreateJob が必ず失敗します。**

### 再生に必須（エンコードはできるが再生できない場合）

| 変数 | 説明 |
| --- | --- |
| `CLOUDFRONT_VIDEO_DOMAIN` | 動画配信ディストリビューションのドメイン |
| `CLOUDFRONT_KEY_PAIR_ID` | 署名付き URL 用のパブリックキー ID |
| `CLOUDFRONT_PRIVATE_KEY` | 署名用の秘密鍵 (PEM) |

### 完了時の自動公開に必要

| 変数 | 説明 |
| --- | --- |
| `CRON_SECRET` | `video-job-complete` Lambda と共有する認証シークレット |

未設定でも動作しますが、エンコード完了後に管理画面から
**「手動で公開（READY化）」** を押す必要があります。

### 任意（既定値で動作）

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `MEDIACONVERT_OUTPUT_PREFIX` | `hls` | 出力プレフィックス |
| `MEDIACONVERT_QUALITIES` | `480p,720p,1080p` | 出力レンディション |
| `MEDIACONVERT_SEGMENT_SECONDS` | `6` | HLS セグメント長（秒） |
| `MEDIACONVERT_ENDPOINT` | (自動解決) | アカウント固有エンドポイント |
| `MEDIACONVERT_QUEUE_ARN` | (デフォルトキュー) | 専用キューを使う場合 |

---

## 手順 A: CDK でセットアップする（推奨）

`infra/lib/storage-stack.ts` が MediaConvert ロールを作成し、
必要な値を SSM Parameter Store に自動登録します。

```bash
# 1. Storage スタックを更新 (MediaConvert ロール + SSM パラメータを作成)
pnpm --filter @idol/infra cdk deploy 'idol-fansite-dev-storage'

# 2. EC2 スタックを更新 (PassRole 権限 + .env.production への注入)
pnpm --filter @idol/infra cdk deploy 'idol-fansite-dev-ec2'
```

作成される SSM パラメータ:

| パラメータ | 対応する環境変数 |
| --- | --- |
| `/<app>/<env>/mediaconvert/role-arn` | `MEDIACONVERT_ROLE_ARN` |
| `/<app>/<env>/mediaconvert/output-prefix` | `MEDIACONVERT_OUTPUT_PREFIX` |
| `/<app>/<env>/s3/media-output-bucket` | `S3_MEDIA_OUTPUT_BUCKET` |
| `/<app>/<env>/cloudfront/video-domain` | `CLOUDFRONT_VIDEO_DOMAIN` |
| `/<app>/<env>/cloudfront/asset-domain` | `CLOUDFRONT_ASSET_DOMAIN` |

### 既存インスタンスに反映する

EC2 を作り直さずに `.env.production` を更新する場合:

```bash
# SSM Session Manager で EC2 に接続してから
bash /home/ec2-user/app/deploy/regenerate-env.sh
bash /home/ec2-user/app/deploy/deploy.sh   # PM2 再起動で反映
```

`regenerate-env.sh` は SSM から MediaConvert / CloudFront / CRON_SECRET を読み直し、
不足があれば警告を出します。

---

## 手順 B: 手動でロールを作る場合

CDK を使わない場合は、以下の信頼ポリシーを持つロールを作成します。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "mediaconvert.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

権限ポリシー（バケット名は実際の値に置換）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSourceVideos",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "arn:aws:s3:::<VIDEO_BUCKET>/source/*"
    },
    {
      "Sid": "ListSourceBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::<VIDEO_BUCKET>"
    },
    {
      "Sid": "WriteHlsOutput",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<MEDIA_OUTPUT_BUCKET>/hls/*"
    },
    {
      "Sid": "ListOutputBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::<MEDIA_OUTPUT_BUCKET>"
    }
  ]
}
```

さらに、ジョブを投入する側（EC2 のインスタンスロール）に以下が必要です:

```json
{
  "Effect": "Allow",
  "Action": [
    "mediaconvert:CreateJob",
    "mediaconvert:GetJob",
    "mediaconvert:ListJobs",
    "mediaconvert:DescribeEndpoints"
  ],
  "Resource": "*"
},
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "<作成したロールの ARN>",
  "Condition": {
    "StringEquals": { "iam:PassedToService": "mediaconvert.amazonaws.com" }
  }
}
```

---

## エンコード出力仕様

`apps/web/src/lib/mediaconvert.ts` で定義しています。

| 画質 | 解像度 | 最大ビットレート | プロファイル |
| --- | --- | --- | --- |
| 480p | 854x480 | 1.2 Mbps | H.264 Main |
| 720p | 1280x720 | 3.0 Mbps | H.264 Main |
| 1080p | 1920x1080 | 6.0 Mbps | H.264 High |

- レート制御: **QVBR**（品質基準の可変ビットレート）
- 音声: AAC-LC 128kbps / 48kHz / ステレオ
- GOP 長をセグメント長に揃え、`GopClosedCadence=1` で ABR 切り替えを安定化
- 入力の回転メタデータは `Rotate: AUTO` で自動補正（スマホ縦動画対応）
- サムネイル: `FRAME_CAPTURE` で 1 枚を `hls/<videoId>/thumbnail.0000000.jpg` に出力

プラン別の再生上限画質は `packages/shared/src/plan-benefits.ts` の
`MAX_VIDEO_QUALITY`（FREE=480p / STANDARD=720p / PREMIUM=1080p）で、
`HlsPlayer` の `maxHeight` によりクライアント側でレンディションを制限します。

---

## 動作確認

```bash
# 設定状況を JSON で確認 (CONTENT 権限が必要)
curl -s https://<your-domain>/api/admin/videos/encode-config \
  -H "Cookie: <管理者セッション>" | jq
```

管理画面 `/admin/videos/new` の「現在のエンコード設定」からも同じ情報を確認できます。

## トラブルシューティング

| 症状 | 原因と対処 |
| --- | --- |
| 「エンコードを実行できません」 | `MEDIACONVERT_ROLE_ARN` 等が未設定。手順 A/B を実施 |
| ジョブ作成が `AccessDenied` で失敗 | EC2 ロールの `iam:PassRole` 対象がロール ARN と不一致 |
| ジョブが `ERROR` で終わる | MediaConvert ロールに入力 `source/*` の読み取り権限が無い |
| 再生時に 403 | CloudFront 署名鍵が未設定、または署名鍵がキーグループに未登録 |
| 再生時に 404 | HLS の出力先が CloudFront のオリジンバケットと不一致 |
| 完了しても READY にならない | `CRON_SECRET` 未設定 or Lambda 未デプロイ。「手動で公開」で回避可能 |
