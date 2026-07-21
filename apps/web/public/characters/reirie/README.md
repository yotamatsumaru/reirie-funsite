# あっち向いてホイ キャラクター画像 (REIRIE)

このフォルダに **REIRIE 本人のキャラクター画像** を置くと、ゲームの絵が
プレースホルダー(SVG)から本人画像に切り替わります。

## 置くファイル (5 枚)

| ファイル名      | 用途                         |
| --------------- | ---------------------------- |
| `idle.png`      | 待機(正面)                   |
| `up.png`        | あっち向いてホイ「上」横顔   |
| `down.png`      | あっち向いてホイ「下」横顔   |
| `left.png`      | あっち向いてホイ「左」横顔   |
| `right.png`     | あっち向いてホイ「右」横顔   |

- 推奨: 正方形・透過 PNG (背景なし)・1 辺 320px 以上。
- 全部そろわなくても OK。無いファイルは自動で SVG プレースホルダーになります。
- 拡張子を `jpg` / `webp` にしたい場合は
  `apps/web/src/app/(members)/me/games/acchi/character.ts` の
  `CHARACTER_IMAGE_EXT` を変更してください。

## 切り替え方法

画像を置いたら、
`apps/web/src/app/(members)/me/games/acchi/character.ts` の

```ts
export const CHARACTER_IMAGES_ENABLED = false;
```

を `true` に変えるだけ。
(true でも、ファイルが見つからないポーズは自動的に SVG にフォールバックします)
