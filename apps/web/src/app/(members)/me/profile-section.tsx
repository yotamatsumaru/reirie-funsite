'use client';

/**
 * マイページ内の「登録情報（お届け先）」セクション。
 *  - 新規登録時に入力した氏名・電話番号・生年月日・住所を表示する。
 *  - 「編集」ボタンで同じ項目を編集フォームに切り替え、PATCH /api/me で更新する。
 *  - グッズ発送に必要な情報のため、住所を最新に保てるようにするのが目的。
 *  - バリデーションはサーバ側 (UpdateProfileSchema) を正とし、ここでは最低限の
 *    必須チェック + サーバのエラーメッセージ表示のみ行う。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PREFECTURES } from '@idol/shared';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

export interface ProfileInfo {
  fullName: string | null;
  furigana: string | null;
  phone: string | null;
  birthDate: string | null; // YYYY-MM-DD
  postalCode: string | null;
  prefecture: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
}

const DASH = '—';

function display(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : DASH;
}

/** 住所を1行にまとめて表示する (郵便番号 / 都道府県 / 市区町村番地 / 建物名) */
function formatAddress(info: ProfileInfo): string {
  const parts = [
    info.postalCode ? `〒${info.postalCode}` : '',
    info.prefecture ?? '',
    info.addressLine1 ?? '',
    info.addressLine2 ?? '',
  ].filter((p) => p.trim().length > 0);
  return parts.length > 0 ? parts.join(' ') : DASH;
}

export function ProfileSection({ initial }: { initial: ProfileInfo }) {
  const router = useRouter();
  const [info, setInfo] = useState<ProfileInfo>(initial);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 編集フォームの入力値 (null を空文字に正規化して保持する)
  const [form, setForm] = useState({
    fullName: initial.fullName ?? '',
    furigana: initial.furigana ?? '',
    phone: initial.phone ?? '',
    birthDate: initial.birthDate ?? '',
    postalCode: initial.postalCode ?? '',
    prefecture: initial.prefecture ?? '東京都',
    addressLine1: initial.addressLine1 ?? '',
    addressLine2: initial.addressLine2 ?? '',
  });

  const update =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function startEdit() {
    // 表示中の値を編集フォームに反映してから開く
    setForm({
      fullName: info.fullName ?? '',
      furigana: info.furigana ?? '',
      phone: info.phone ?? '',
      birthDate: info.birthDate ?? '',
      postalCode: info.postalCode ?? '',
      prefecture: info.prefecture ?? '東京都',
      addressLine1: info.addressLine1 ?? '',
      addressLine2: info.addressLine2 ?? '',
    });
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          furigana: form.furigana.trim() || undefined,
          phone: form.phone.trim(),
          birthDate: form.birthDate || undefined,
          postalCode: form.postalCode.trim(),
          prefecture: form.prefecture,
          addressLine1: form.addressLine1.trim(),
          addressLine2: form.addressLine2.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(j.error?.message ?? '更新に失敗しました。入力内容をご確認ください。');
        setSubmitting(false);
        return;
      }
      // 表示用 state を更新して表示モードへ戻す
      setInfo({
        fullName: form.fullName.trim() || null,
        furigana: form.furigana.trim() || null,
        phone: form.phone.trim() || null,
        birthDate: form.birthDate || null,
        postalCode: form.postalCode.trim() || null,
        prefecture: form.prefecture || null,
        addressLine1: form.addressLine1.trim() || null,
        addressLine2: form.addressLine2.trim() || null,
      });
      setEditing(false);
      setSubmitting(false);
      toast.success('登録情報を更新しました');
      // サーバコンポーネント側の表示も最新化する
      router.refresh();
    } catch {
      setError('通信エラーが発生しました。時間を置いて再度お試しください');
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <dl className="divide-y divide-slate-100">
        <Row label="お名前 (氏名)" value={display(info.fullName)} />
        {info.furigana && <Row label="フリガナ" value={display(info.furigana)} />}
        <Row label="電話番号" value={display(info.phone)} />
        <Row label="生年月日" value={display(info.birthDate)} />
        <Row label="お届け先住所" value={formatAddress(info)} />
        <div className="pt-4">
          <Button variant="secondary" onClick={startEdit}>
            登録情報を編集
          </Button>
        </div>
      </dl>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        グッズの発送に使用する情報です。引っ越しなどで変わった場合は最新の内容に更新してください。
      </p>

      <Input
        label="お名前 (氏名)"
        type="text"
        name="fullName"
        autoComplete="name"
        required
        maxLength={100}
        placeholder="例: 山田 花子"
        value={form.fullName}
        onChange={update('fullName')}
        disabled={submitting}
      />
      <Input
        label="フリガナ (任意)"
        type="text"
        name="furigana"
        maxLength={100}
        placeholder="例: ヤマダ ハナコ"
        value={form.furigana}
        onChange={update('furigana')}
        disabled={submitting}
      />
      <Input
        label="電話番号"
        type="tel"
        name="phone"
        autoComplete="tel"
        required
        placeholder="例: 090-1234-5678"
        value={form.phone}
        onChange={update('phone')}
        disabled={submitting}
      />
      <Input
        label="生年月日"
        type="date"
        name="birthDate"
        autoComplete="bday"
        value={form.birthDate}
        onChange={update('birthDate')}
        disabled={submitting}
      />
      <Input
        label="郵便番号"
        type="text"
        name="postalCode"
        autoComplete="postal-code"
        required
        placeholder="例: 1234567"
        hint="ハイフンあり・なしどちらでも可"
        value={form.postalCode}
        onChange={update('postalCode')}
        disabled={submitting}
      />
      <Select
        label="都道府県"
        name="prefecture"
        required
        value={form.prefecture}
        onChange={update('prefecture')}
        disabled={submitting}
      >
        {PREFECTURES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Input
        label="市区町村・番地"
        type="text"
        name="addressLine1"
        autoComplete="address-line1"
        required
        maxLength={200}
        placeholder="例: 渋谷区道玄坂1-2-3"
        value={form.addressLine1}
        onChange={update('addressLine1')}
        disabled={submitting}
      />
      <Input
        label="建物名・部屋番号 (任意)"
        type="text"
        name="addressLine2"
        autoComplete="address-line2"
        maxLength={200}
        placeholder="例: ○○マンション 101号室"
        value={form.addressLine2}
        onChange={update('addressLine2')}
        disabled={submitting}
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} loading={submitting} disabled={submitting}>
          保存する
        </Button>
        <Button variant="ghost" onClick={cancelEdit} disabled={submitting}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-xs text-slate-500 sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="text-sm text-slate-900 sm:flex-1 sm:text-right">{value}</dd>
    </div>
  );
}
