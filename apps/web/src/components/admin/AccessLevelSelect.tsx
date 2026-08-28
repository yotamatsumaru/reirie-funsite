/**
 * 公開範囲（AccessLevel）の選択 UI。
 *
 * ## なぜ共通コンポーネントにしているか
 * 以前は動画アップロード / 動画編集 / コンテンツ編集の各画面が
 * それぞれ独自に <option> をベタ書きしていた結果、同じ MEMBERS を
 *   - アップロード画面: 「会員（無料プラン以上）」
 *   - 編集画面:         「会員限定（スタンダード以上）」
 *   - コンテンツ画面:   「会員以上 (MEMBERS)」
 * と別々に表記しており、しかもアップロード画面の表記は実際の判定
 * （canAccess は MEMBERS にスタンダード以上を要求する）と食い違っていた。
 * 運営が「無料会員にも見せるつもり」で選んだ動画が無料会員に見えない、
 * という事故が起きうる状態だったため、選択肢とラベルをここに一本化する。
 *
 * ラベルの実体は @idol/shared の ACCESS_LEVEL_LABELS。
 * 段階を増やすときは shared 側と Prisma enum を直せば全画面に反映される。
 */
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_DESCRIPTIONS,
  ACCESS_LEVEL_LABELS,
  type AccessLevelLiteral,
} from '@idol/shared';
import { Select } from '@/components/ui/Input';

export function AccessLevelSelect({
  value,
  onChange,
  disabled,
  name = 'accessLevel',
  label = '公開範囲',
}: {
  value: string;
  onChange: (value: AccessLevelLiteral) => void;
  disabled?: boolean;
  name?: string;
  label?: string;
}) {
  const current = ACCESS_LEVEL_DESCRIPTIONS[value as AccessLevelLiteral];

  return (
    <div className="space-y-1">
      <Select
        label={label}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value as AccessLevelLiteral)}
        disabled={disabled}
      >
        {ACCESS_LEVELS.map((level) => (
          <option key={level} value={level}>
            {ACCESS_LEVEL_LABELS[level]}
          </option>
        ))}
      </Select>
      {/* 「会員限定」と「無料会員以上」はラベルだけだと違いが分かりにくいので、
          選択中の範囲が誰に見えるのかを必ず一行で示す。 */}
      {current && <p className="text-xs text-slate-500">{current}</p>}
    </div>
  );
}
