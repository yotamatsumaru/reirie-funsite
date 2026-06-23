# ReiRieRoom — デザインガイド

REIRIE 公式ファンクラブサイト **ReiRieRoom** のデザイン仕様書。
アーティスト REIRIE（黒宮れい × 金子理江）の世界観に基づく。

---

## 🎨 コンセプト

**「The Amethyst Room — 薔薇色の黄昏（Rosy Twilight）」**

ファンクラブ = ファンだけが入れる "紫水晶の部屋"。
メジャー1st EP『Amethyst（紫水晶）』にちなみ、アメジストをモチーフに、
夜明け前／夕暮れのようにピンクと紫が溶け合う、ロマンティックで優しいトーン。

- 公式サイト（reirie.jp）の「白基調でふわっと霧がかった儚い世界観」を継承
- 甘さ・優しさ ＋ ほどよい深みと品（「大人かわいい」バランス）
- ダークすぎず・淡すぎず、の中間トーン

---

## 🎨 カラーパレット（Rosy Twilight）

| 役割 | 名称 | HEX | 用途 |
|---|---|---|---|
| 主役 | Dusty Rose | `#E8A8C8` | 背景グラデ上側・主要アクセント |
| 主役 | Mauve Pink | `#D98FB5` | 背景グラデ中間 |
| アクセント | Soft Amethyst | `#9B6FC4` | ボタン・リンク・REIRIEらしい紫 |
| 奥行き | Plum Violet | `#4A2D5C` | 背景の端／下部・締まり・文字 |
| 文字/ロゴ | Cream Pink | `#FBEEF5` | 見出し・ロゴ・本文（明色） |
| 差し色 | Rose Gold | `#E6B88A` | 会員ランク・特別感の装飾 |

### グラデーション
```css
/* メイン背景 (Rosy Twilight) */
background: linear-gradient(160deg, #E8A8C8 0%, #D98FB5 35%, #9B6FC4 70%, #4A2D5C 100%);

/* ボタン (Pink → Purple) */
background: linear-gradient(135deg, #E8A8C8 0%, #9B6FC4 100%);
```

---

## ✍️ タイポグラフィ

| 用途 | フォント | 備考 |
|---|---|---|
| 見出し（英字） | **Cormorant Garamond** | 上品・神秘的なセリフ。公式と統一 |
| アクセント見出し | **Shrikhand** | 遊び心。限定使用 |
| 日本語 | **Zen Maru Gothic** | 丸み・親しみ。ファンクラブの親密さに最適 |
| 数字・ラベル | 細身サンセリフ | `01 / 02` 連番表記（公式ナビ手法を踏襲） |

Google Fonts:
```
Cormorant+Garamond:wght@400;600 / Zen+Maru+Gothic:wght@500;700;900 / Shrikhand
```

---

## 💠 UI スタイル指針

- **グラスモーフィズム**: フロストガラス（半透明・ぼかし）のカード
- **大きな角丸**: カード `border-radius: 24px` 程度、ボタンは丸みのあるピル型
- **細く繊細な線**: ボーダーは 1px・低彩度
- **たっぷりの余白**: 軽やかで呼吸感のあるレイアウト
- **やわらかい発光**: グロー・ボケ・きらめき（sparkle）・フォググレイン
- **パール/虹彩**: 会員証などにロゼ系の iridescent シーン
- ❌ カスタムカーソルは **使用しない**

---

## 🏛️ 主要画面（デザインカンプ）

確定トーン「Rosy Twilight」で生成したカンプ一覧。

| 画面 | カンプURL |
|---|---|
| ① トップ ヒーロー＆会員ランク | https://www.genspark.ai/api/files/s/7RG5ORbo |
| ② デジタル会員証カード | https://www.genspark.ai/api/files/s/IMbWLkaK |
| ③ マイページ（ダッシュボード） | https://www.genspark.ai/api/files/s/nSQeUB9i |
| ④ 限定コンテンツ＆特典会 | https://www.genspark.ai/api/files/s/Ik3drgkp |
| ⑤ ログイン／会員登録 | https://www.genspark.ai/api/files/s/vLTjAqUg |
| ⑥ モバイル版 | https://www.genspark.ai/api/files/s/Evl76Kxm |

> ※ 上記URLはプレビュー用。実装時はアセットをリポジトリ／CDNに配置する。

---

## 📐 ページ構成（ファンクラブ機能）

既存システム（Next.js）の機能を本トーンでラッピングする。

```
Hero            動画/アー写 + フォググレイン + sparkle
                "ReiRieRoom" / "Welcome to the Amethyst Room"
Membership      会員ランク (Crystal / Amethyst / Royal) — フロストガラスカード
Contents        会員限定（Photo / Blog / Off-shot / Voice）ロック付きカード
Movie / Live    限定動画・ライブ配信アーカイブ
特典会 / 1on1    "部屋に入る (Enter the Room)" 演出 → 待機 → 通話
Goods / EC      会員価格・限定グッズ
Schedule        リスト/カレンダー切替（公式同様）
Mypage          デジタル会員証・ポイント・購入履歴・次回イベント
```

---

## 🔑 ブランド情報

- ユニット: REIRIE（黒宮れい × 金子理江、5年ぶり再集結）
- メジャー1st EP: 『Amethyst』
- テーマ: 「愛と希望の革命」
- 公式: https://reirie.jp/ ／ X: @REIRIEofficial ／ IG: reirieofficial
- ファンクラブ名: **ReiRieRoom**
