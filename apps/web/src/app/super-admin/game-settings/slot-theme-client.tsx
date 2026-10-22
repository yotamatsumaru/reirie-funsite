'use client';

/**
 * スロットの見た目テーマ (通常 / ハロウィン) の切替 UI (SUPER_ADMIN)。
 *
 * テーマは絵柄の絵文字・名前・文言・配色だけを変える。役・確率・配当は変わらないので、
 * 期間中に切り替えても出玉やポイント経済には影響しない。
 */
import { useState } from 'react';
import {
  SLOT_SYMBOLS,
  SLOT_THEME_DEFINITIONS,
  SLOT_THEME_MODES,
  SLOT_THEME_MODE_LABEL,
  resolveSlotTheme,
  type SlotTheme,
  type SlotThemeMode,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

const THEME_NAME: Record<SlotTheme, string> = {
  default: '通常',
  halloween: 'ハロウィン',
};

export function SlotThemeClient({ initial }: { initial: SlotThemeMode }) {
  const [mode, setMode] = useState<SlotThemeMode>(initial);
  const [saved, setSaved] = useState<SlotThemeMode>(initial);
  const [saving, setSaving] = useState(false);

  // 「今このモードにしたら会員にはどちらが表示されるか」をその場で示す
  const active = resolveSlotTheme(mode);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/super-admin/slot-theme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? '保存に失敗しました');
      setSaved(json.mode as SlotThemeMode);
      toast.success(`スロットのテーマを保存しました (現在: ${THEME_NAME[json.activeTheme as SlotTheme]})`);
    } catch (e) {
      toast.error((e as Error).message, '保存エラー');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-800">スロット 見た目テーマ (季節イベント)</h2>
        <p className="mt-1 text-xs text-slate-500">
          絵柄・文言・配色だけが変わります。当選確率と配当は変わりません。
        </p>
      </CardHeader>
      <CardBody>
        <fieldset className="space-y-2">
          <legend className="sr-only">テーマ</legend>
          {SLOT_THEME_MODES.map((m) => (
            <label
              key={m}
              className={[
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm',
                mode === m ? 'border-twilight-amethyst bg-rose-50' : 'border-slate-200 bg-slate-50',
              ].join(' ')}
            >
              <input
                type="radio"
                name="slot-theme-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              <span className="font-medium text-slate-800">{SLOT_THEME_MODE_LABEL[m]}</span>
            </label>
          ))}
        </fieldset>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">
            この設定で会員に表示されるテーマ (現在時刻):{' '}
            <span className="font-bold text-slate-800">{THEME_NAME[active]}</span>
          </p>
          <p className="mt-2 text-2xl tracking-wider" aria-label={`${THEME_NAME[active]}テーマの絵柄`}>
            {SLOT_SYMBOLS.map((s) => SLOT_THEME_DEFINITIONS[active].symbolEmoji[s]).join(' ')}
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          {mode !== saved ? <span className="text-xs text-amber-600">未保存の変更があります</span> : null}
          <Button onClick={save} loading={saving} variant="primary" disabled={mode === saved}>
            テーマを保存
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
