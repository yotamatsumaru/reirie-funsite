/**
 * MyRoom（家具の部屋）— 家具マスタの定義とバリデーション。
 *
 * 【MyRoom 機能全体の段階リリースについて】
 * MyRoom は 3 段階に分けて開発する。
 *   1. 家具マスタ管理（このファイル / 本PR）… 運営が管理画面から家具を追加する
 *   2. 部屋の編集・保存                      … 会員が家具を配置し、Pui で購入する
 *   3. 公開・モデレーション                  … 他の会員の部屋を見られるようにする
 *
 * 会員向けの機能は「まだ公開しない・管理者だけが触れる」状態から始める。
 * そのため site.sectionVisibility の myRoomVisible は既定 false であり、
 * 一般会員には 404、管理者にはプレビュー表示となる
 * (site-section-visibility.ts の canViewMyRoomSection を参照)。
 *
 * 【このファイルの役割】
 * 家具の分類・入力値の検証を「純粋な関数 / スキーマ」として持つ。DB や
 * next/server に依存させないことで、jest から直接テストできるようにしている。
 */
import { z } from 'zod';

// ===========================================================================
// 家具の分類
// ===========================================================================

/**
 * 家具の分類。管理画面の絞り込みと、会員向けショップのタブ分けに使う。
 *
 * 部屋のどこに置けるかで分けている（床・壁・床の上に重ねる小物）。
 * 見た目のジャンル（かわいい系/シンプル系など）で分けていないのは、
 * 配置ロジック（PR2）が「壁の家具は壁面にしか置けない」といった判定を
 * この分類で行うため。ジャンルはタグとして後から足せる。
 */
export const MYROOM_FURNITURE_CATEGORIES = [
  'FLOOR',
  'WALL',
  'DESKTOP',
  'RUG',
  'PLANT',
  'OTHER',
] as const;

export type MyRoomFurnitureCategory = (typeof MYROOM_FURNITURE_CATEGORIES)[number];

export const MYROOM_FURNITURE_CATEGORY_LABELS: Record<MyRoomFurnitureCategory, string> = {
  FLOOR: '床置き家具',
  WALL: '壁掛け',
  DESKTOP: '机の上の小物',
  RUG: 'ラグ・カーペット',
  PLANT: '植物',
  OTHER: 'その他',
};

/** 分類の説明（管理画面のヘルプ表示用） */
export const MYROOM_FURNITURE_CATEGORY_DESCRIPTIONS: Record<MyRoomFurnitureCategory, string> = {
  FLOOR: 'ベッド・ソファ・棚など、床に直接置く大きめの家具',
  WALL: 'ポスター・時計・窓など、壁面に取り付けるもの',
  DESKTOP: '机や棚の上に重ねて置く小物',
  RUG: '床に敷くもの。他の家具を上に置ける',
  PLANT: '観葉植物・花など',
  OTHER: '上のどれにも当てはまらないもの',
};

export function isMyRoomFurnitureCategory(value: unknown): value is MyRoomFurnitureCategory {
  return (
    typeof value === 'string' &&
    (MYROOM_FURNITURE_CATEGORIES as readonly string[]).includes(value)
  );
}

// ===========================================================================
// 公開状態
// ===========================================================================

/**
 * 家具マスタ 1 件ごとの状態。
 *
 * - DRAFT     … 準備中。会員向けショップには絶対に出ない（画像差し替え中など）
 * - PUBLISHED … 会員向けショップに並ぶ
 * - ARCHIVED  … 販売終了。新規購入はできないが、既に部屋に置いている会員の
 *               家具は消さない（購入済みのものが突然消える事故を防ぐ）
 *
 * 物理削除も可能だが、購入実績がある家具は削除できないようにする想定
 * （PR2 で購入履歴が入った時点で参照制約を付ける）。それまでの間も
 * ARCHIVED を使えば「もう売らないが履歴は残す」が表現できる。
 */
export const MYROOM_FURNITURE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

export type MyRoomFurnitureStatus = (typeof MYROOM_FURNITURE_STATUSES)[number];

export const MYROOM_FURNITURE_STATUS_LABELS: Record<MyRoomFurnitureStatus, string> = {
  DRAFT: '準備中',
  PUBLISHED: '販売中',
  ARCHIVED: '販売終了',
};

// ===========================================================================
// 入力値の制約
// ===========================================================================

export const MYROOM_FURNITURE_NAME_MAX = 60;
export const MYROOM_FURNITURE_DESCRIPTION_MAX = 300;

/**
 * Pui 価格の上限。
 *
 * 上限を設ける理由は「桁の打ち間違い」を止めるため。1,000 のつもりで
 * 1000000 と入れてしまうと、会員から見て永久に買えない家具になり、
 * しかも見た目では気づきにくい。実運用で想定する最高価格
 * （数万 Pui）から十分な余裕を取って 1,000,000 とする。
 */
export const MYROOM_FURNITURE_PUI_COST_MAX = 1_000_000;

/**
 * 家具が占めるマス数の上限。
 *
 * 部屋のグリッドは 12x12 マスを想定しているため、それを超えるサイズは
 * どう配置しても部屋に収まらない。入力段階で弾く。
 * （グリッドそのものの実装は PR2）
 */
export const MYROOM_GRID_SIZE = 12;
export const MYROOM_FURNITURE_CELLS_MAX = MYROOM_GRID_SIZE;

/** 家具画像の上限サイズ */
export const MAX_MYROOM_FURNITURE_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

/**
 * 家具画像で許可する形式。
 *
 * - PNG / WebP を推奨（家具は背景を透過させたいため）
 * - JPEG も許可するが透過できない。運用で気づけるよう管理画面に注意書きを出す
 * - GIF は許可しない。家具が動くと部屋全体が騒がしくなるため（意図的な制限）
 * - SVG は許可しない。スクリプトを埋め込めるため
 */
export const ALLOWED_MYROOM_FURNITURE_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

export type MyRoomFurnitureImageValidation =
  | { ok: true; ext: string }
  | { ok: false; message: string };

/** 見やすいバイト数表記（エラーメッセージ用） */
export function formatMyRoomImageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 家具画像のアップロード可否を判定する。
 * サーバー側の最終チェックと、クライアント側の事前チェックの両方から呼ぶ。
 */
export function validateMyRoomFurnitureImage(params: {
  contentType: string;
  sizeBytes: number;
}): MyRoomFurnitureImageValidation {
  const { contentType, sizeBytes } = params;
  const ext = ALLOWED_MYROOM_FURNITURE_IMAGE_TYPES[contentType];
  if (!ext) {
    return {
      ok: false,
      message: `この画像形式には対応していません（${contentType || '不明な形式'}）。PNG・WebP・JPEG のいずれかを使ってください。家具は背景を透過できる PNG か WebP がおすすめです。`,
    };
  }
  if (sizeBytes <= 0) {
    return { ok: false, message: '画像ファイルが空です。' };
  }
  if (sizeBytes > MAX_MYROOM_FURNITURE_IMAGE_BYTES) {
    return {
      ok: false,
      message: `画像サイズが大きすぎます（${formatMyRoomImageBytes(sizeBytes)}）。${formatMyRoomImageBytes(MAX_MYROOM_FURNITURE_IMAGE_BYTES)}以下にしてください。`,
    };
  }
  return { ok: true, ext };
}

// ===========================================================================
// 家具マスタの入力スキーマ
// ===========================================================================

/**
 * 家具マスタの作成・更新の入力スキーマ。
 *
 * 【.default() を付けていない理由】
 * PATCH では `.partial()` して「変更されたフィールドだけ」を受け取るが、
 * Zod の `.partial()` は `.default()` を残すため、default があると
 * 「送られなかったフィールドが既定値で上書きされる」不具合になる
 * （site-section-visibility.ts と同じ落とし穴）。既定値は作成時に
 * 呼び出し側で明示する。
 */
export const MyRoomFurnitureInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, '家具の名前を入力してください')
    .max(
      MYROOM_FURNITURE_NAME_MAX,
      `家具の名前は${MYROOM_FURNITURE_NAME_MAX}文字以内にしてください`,
    ),
  description: z
    .string()
    .trim()
    .max(
      MYROOM_FURNITURE_DESCRIPTION_MAX,
      `説明は${MYROOM_FURNITURE_DESCRIPTION_MAX}文字以内にしてください`,
    )
    .nullable(),
  category: z.enum(MYROOM_FURNITURE_CATEGORIES),
  status: z.enum(MYROOM_FURNITURE_STATUSES),
  /** 購入に必要な Pui。0 なら無料配布の家具 */
  puiCost: z
    .number()
    .int('Pui は整数で入力してください')
    .min(0, 'Pui は 0 以上で入力してください')
    .max(
      MYROOM_FURNITURE_PUI_COST_MAX,
      `Pui は${MYROOM_FURNITURE_PUI_COST_MAX.toLocaleString()}以下で入力してください`,
    ),
  widthCells: z
    .number()
    .int()
    .min(1, '幅は1マス以上にしてください')
    .max(MYROOM_FURNITURE_CELLS_MAX, `幅は${MYROOM_FURNITURE_CELLS_MAX}マス以下にしてください`),
  heightCells: z
    .number()
    .int()
    .min(1, '高さは1マス以上にしてください')
    .max(MYROOM_FURNITURE_CELLS_MAX, `高さは${MYROOM_FURNITURE_CELLS_MAX}マス以下にしてください`),
  sortOrder: z.number().int().min(0),
});

export type MyRoomFurnitureInput = z.infer<typeof MyRoomFurnitureInputSchema>;

/** PATCH 用（変更されたフィールドのみ） */
export const MyRoomFurniturePatchSchema = MyRoomFurnitureInputSchema.partial();

export type MyRoomFurniturePatch = z.infer<typeof MyRoomFurniturePatchSchema>;

/**
 * 新規作成フォームの初期値。
 *
 * 【型が MyRoomFurnitureInput ではない理由】
 * name は空文字から始まるため、この値は MyRoomFurnitureInputSchema を
 * 満たさない（満たしてしまうと「名前が空でも保存できる」ことになる）。
 * 「フォームの下書き状態」と「保存できる確定値」は別物なので、型も分ける。
 * 送信時に MyRoomFurnitureInputSchema でパースして初めて確定値になる。
 */
export type MyRoomFurnitureDraft = {
  name: string;
  description: string | null;
  category: MyRoomFurnitureCategory;
  status: MyRoomFurnitureStatus;
  puiCost: number;
  widthCells: number;
  heightCells: number;
  sortOrder: number;
};

export const DEFAULT_MYROOM_FURNITURE_DRAFT: MyRoomFurnitureDraft = {
  name: '',
  description: null,
  category: 'FLOOR',
  // 既定は「準備中」。画像を入れ忘れたまま販売中になる事故を防ぐため、
  // 公開は必ず運営の明示的な操作にする。
  status: 'DRAFT',
  puiCost: 0,
  widthCells: 1,
  heightCells: 1,
  sortOrder: 0,
};

/**
 * 家具を会員向けショップに並べてよいか。
 *
 * 画像のない家具は、並べても会員には何も見えない（透明な家具を買わせて
 * しまう）ため、PUBLISHED でも画像必須とする。
 */
export function isMyRoomFurniturePurchasable(furniture: {
  status: MyRoomFurnitureStatus;
  imageUrl: string | null;
}): boolean {
  return furniture.status === 'PUBLISHED' && Boolean(furniture.imageUrl);
}

/**
 * 「販売中にしたのに会員に見えていない」原因を説明する文。
 * 管理画面で警告として出し、運営が気づけるようにする。
 * 問題がなければ null。
 */
export function myRoomFurnitureWarning(furniture: {
  status: MyRoomFurnitureStatus;
  imageUrl: string | null;
}): string | null {
  if (furniture.status === 'PUBLISHED' && !furniture.imageUrl) {
    return '画像が未設定のため、販売中にしても会員には表示されません。画像を登録してください。';
  }
  return null;
}
