'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PREFECTURES } from '@idol/shared';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatPostalCode, lookupPostalCode, normalizePostalCode } from '@/lib/postal-lookup';

const INITIAL = {
  displayName: '',
  fullName: '',
  email: '',
  phone: '',
  birthDate: '',
  postalCode: '',
  prefecture: '東京都',
  addressLine1: '',
  addressLine2: '',
  password: '',
};

export function SignUpForm() {
  const router = useRouter();
  const [form, setForm] = useState({ ...INITIAL });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 郵便番号 → 住所 自動補完の状態表示用
  //  idle / searching / found / not-found (実在しない) / unavailable (検索できなかった)
  const [postalState, setPostalState] = useState<
    'idle' | 'searching' | 'found' | 'not-found' | 'unavailable'
  >('idle');
  // 直近の検索対象。非同期の遅延結果が新しい入力を上書きしないようにするため保持する。
  const latestZipRef = useRef<string | null>(null);

  const update =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }));

  // 郵便番号の変更ハンドラ。7桁揃ったら住所を自動補完する。
  //  - 都道府県 (prefecture) を上書きする。
  //  - 市区町村・番地 (addressLine1) は「まだ空のときだけ」市区町村＋町域を差し込む
  //    (ユーザーが番地まで入力済みの場合に消してしまわないため)。
  // 住所検索に失敗しても登録はブロックしない (手入力にフォールバックできる)。
  const onPostalChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, postalCode: value }));

    const zip = normalizePostalCode(value);
    if (!zip) {
      latestZipRef.current = null;
      setPostalState('idle');
      return;
    }

    latestZipRef.current = zip;
    setPostalState('searching');
    const result = await lookupPostalCode(zip);
    // 入力が進んで別の郵便番号になっていたら、この結果は破棄する
    if (latestZipRef.current !== zip) return;

    if (result.status !== 'found') {
      setPostalState(result.status);
      return;
    }
    setPostalState('found');
    setForm((prev) => ({
      ...prev,
      prefecture: result.prefecture || prev.prefecture,
      addressLine1: prev.addressLine1.trim() === '' ? result.city : prev.addressLine1,
    }));
  };

  // 郵便番号欄に出すヒント文。
  // 「検索できなかった」ときに「存在しない」と言わないことが重要
  // (外部サービス障害時に会員登録を諦めさせてしまうため)。
  const postalHint =
    postalState === 'searching'
      ? '住所を検索中…'
      : postalState === 'found'
        ? '住所を自動入力しました。番地・建物名を続けてご入力ください'
        : postalState === 'not-found'
          ? 'この郵便番号の住所が見つかりませんでした。番号をご確認いただくか、住所を手入力してください'
          : postalState === 'unavailable'
            ? '住所の自動入力が一時的にご利用できません。都道府県・住所を手入力すればそのまま登録できます'
            : '7桁を入力すると都道府県・市区町村を自動入力します（ハイフンあり・なし可）';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName,
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          birthDate: form.birthDate,
          // 全角数字 (「１５７００６６」) や 〒 記号付きで入力されても登録できるよう、
          // サーバのバリデーション (^\d{3}-?\d{4}$) が通る形へ正規化して送る。
          // 携帯の日本語キーボードでは全角数字になりやすく、正規化しないと
          // 「郵便番号は7桁で入力してください」で登録できなくなる。
          postalCode: formatPostalCode(form.postalCode),
          prefecture: form.prefecture,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || undefined,
          password: form.password,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '登録に失敗しました');
      }
      // 登録成功 → 認証コード入力画面へ遷移する。
      // (メールで送られた6桁コードを入力するまでログインできないため、ここでは自動ログインしない)
      const qs = new URLSearchParams({ email: form.email });
      router.push(`/verify-email?${qs.toString()}`);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* アカウント情報 */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-twilight-amethyst">
          アカウント情報
        </legend>
        <Input
          label="ニックネーム (表示名)"
          type="text"
          name="displayName"
          required
          maxLength={50}
          placeholder="例: れいりえ"
          value={form.displayName}
          onChange={update('displayName')}
        />
        <Input
          label="メールアドレス"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="example@mail.com"
          value={form.email}
          onChange={update('email')}
        />
        <Input
          label="パスワード"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          hint="8文字以上・大文字/小文字/数字を含む"
          value={form.password}
          onChange={update('password')}
        />
      </fieldset>

      {/* 本人情報 */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-twilight-amethyst">
          本人情報
        </legend>
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
        />
        <Input
          label="生年月日"
          type="date"
          name="birthDate"
          autoComplete="bday"
          required
          value={form.birthDate}
          onChange={update('birthDate')}
        />
      </fieldset>

      {/* 住所 */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-twilight-amethyst">
          住所
        </legend>
        <Input
          label="郵便番号"
          type="text"
          name="postalCode"
          autoComplete="postal-code"
          inputMode="numeric"
          required
          placeholder="例: 1234567"
          hint={postalHint}
          value={form.postalCode}
          onChange={onPostalChange}
        />
        <Select
          label="都道府県"
          name="prefecture"
          required
          value={form.prefecture}
          onChange={update('prefecture')}
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
        />
        <Input
          label="建物名・部屋番号"
          type="text"
          name="addressLine2"
          autoComplete="address-line2"
          maxLength={200}
          placeholder="例: ○○マンション 101号室"
          hint="マンション・アパートにお住まいの場合は、確実な発送のため必ずご入力ください"
          value={form.addressLine2}
          onChange={update('addressLine2')}
        />
      </fieldset>

      {error && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      )}

      <Button type="submit" loading={loading} className="w-full" size="lg">
        登録する
      </Button>

      <p className="text-xs text-slate-500">
        登録することで{' '}
        <a href="/terms" className="underline">
          利用規約
        </a>{' '}
        および{' '}
        <a href="/privacy" className="underline">
          プライバシーポリシー
        </a>{' '}
        に同意したものとみなされます。
      </p>
    </form>
  );
}
