'use client';

/**
 * 商品の新規作成 / 編集フォーム（共通）
 *  - mode="create" : POST /api/admin/products
 *  - mode="edit"   : PATCH /api/admin/products/[id]
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { fromDatetimeLocalJst, toDatetimeLocalJst } from '@/lib/video-edit';
import { validateSalePeriod } from '@idol/shared';
import { formatJpy } from '@/lib/pricing';

export type CategoryOption = { id: string; name: string };

/** 配送方法の選択肢 (管理画面のチェックボックス用) */
export type ShippingMethodOption = {
  id: string;
  name: string;
  fee: number;
  isDefault: boolean;
  isActive: boolean;
};

export type ProductFormValues = {
  slug: string; // edit 時の表示専用
  name: string;
  description: string;
  basePrice: number;
  memberPrice: string;
  premiumPrice: string;
  categoryId: string;
  isActive: boolean;
  isMembersOnly: boolean;
  isPremiumExclusive: boolean;
  /** ISO 文字列 (null = 制限なし) */
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  /** 割り当て済み配送方法 id */
  shippingMethodIds: string[];
};

export function ProductForm({
  mode,
  productId,
  categories,
  shippingMethods = [],
  initial,
}: {
  mode: 'create' | 'edit';
  productId?: string;
  categories: CategoryOption[];
  shippingMethods?: ShippingMethodOption[];
  initial?: Partial<ProductFormValues>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [basePrice, setBasePrice] = useState<string>(
    initial?.basePrice != null ? String(initial.basePrice) : '',
  );
  const [memberPrice, setMemberPrice] = useState(initial?.memberPrice ?? '');
  const [premiumPrice, setPremiumPrice] = useState(initial?.premiumPrice ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [isMembersOnly, setIsMembersOnly] = useState(initial?.isMembersOnly ?? false);
  const [isPremiumExclusive, setIsPremiumExclusive] = useState(
    initial?.isPremiumExclusive ?? false,
  );
  // 販売期間 (datetime-local は JST として扱う)
  const [saleStartsLocal, setSaleStartsLocal] = useState(
    toDatetimeLocalJst(initial?.saleStartsAt ?? null),
  );
  const [saleEndsLocal, setSaleEndsLocal] = useState(
    toDatetimeLocalJst(initial?.saleEndsAt ?? null),
  );
  // 配送方法
  const [shippingIds, setShippingIds] = useState<string[]>(initial?.shippingMethodIds ?? []);

  const activeShipping = shippingMethods.filter((m) => m.isActive);
  const defaultShipping = activeShipping.filter((m) => m.isDefault);

  function toggleShipping(id: string) {
    setShippingIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('商品名を入力してください。');
      return;
    }
    const basePriceNum = Number(basePrice);
    if (!Number.isInteger(basePriceNum) || basePriceNum < 0) {
      setError('基本価格は 0 以上の整数で入力してください。');
      return;
    }
    const saleStartsAt = fromDatetimeLocalJst(saleStartsLocal);
    const saleEndsAt = fromDatetimeLocalJst(saleEndsLocal);
    const periodError = validateSalePeriod(saleStartsAt, saleEndsAt);
    if (periodError) {
      setError(periodError);
      return;
    }

    const payload: Record<string, unknown> = {
      // slug はサーバー側で商品名から自動生成（送信しない）
      name: name.trim(),
      description: description.trim() || undefined,
      basePrice: basePriceNum,
      memberPrice: memberPrice !== '' ? Number(memberPrice) : undefined,
      premiumPrice: premiumPrice !== '' ? Number(premiumPrice) : undefined,
      categoryId: categoryId || undefined,
      isActive,
      isMembersOnly,
      isPremiumExclusive,
      saleStartsAt,
      saleEndsAt,
      shippingMethodIds: shippingIds,
    };

    startTransition(async () => {
      const url =
        mode === 'create'
          ? '/api/admin/products'
          : `/api/admin/products/${productId}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(j.error?.message ?? `エラーが発生しました (HTTP ${res.status})`);
        return;
      }
      if (mode === 'create') {
        const created = (await res.json()) as { id: string };
        router.push(`/admin/products/${created.id}`);
        router.refresh();
      } else {
        setSuccess('保存しました。');
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">基本情報</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <Input
            label="商品名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 推しTシャツVer.2026"
            required
          />
          {mode === 'edit' && initial?.slug ? (
            <div className="space-y-1">
              <span className="block text-sm font-medium text-slate-700">
                slug (URL識別子・自動生成・変更不可)
              </span>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-500">
                {initial.slug}
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              URLに使われる識別子（slug）は、作成時に商品名から自動で生成されます。後からの変更はできません。
            </p>
          )}
          <Textarea
            label="商品説明（任意）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="商品の特徴や素材などを記載します。"
          />
          <Select
            label="カテゴリ（任意）"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">未分類</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">価格設定（円）</h2>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Input
            label="基本価格"
            type="number"
            min={0}
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            placeholder="3000"
            required
          />
          <Input
            label="会員価格（任意）"
            type="number"
            min={0}
            value={memberPrice}
            onChange={(e) => setMemberPrice(e.target.value)}
            placeholder="2700"
          />
          <Input
            label="プレミアム価格（任意）"
            type="number"
            min={0}
            value={premiumPrice}
            onChange={(e) => setPremiumPrice(e.target.value)}
            placeholder="2400"
          />
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">公開・販売設定</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
            />
            販売中（チェックを外すと非公開）
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isMembersOnly}
              onChange={(e) => setIsMembersOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
            />
            会員限定商品
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isPremiumExclusive}
              onChange={(e) => setIsPremiumExclusive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
            />
            プレミアム会員限定商品
          </label>
        </CardBody>
      </Card>

      {/* ---- 販売期間 (BASE の「販売期間」相当) ---- */}
      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">販売期間（任意）</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-slate-500">
            「販売中」にしたうえで発売開始日時を設定すると、その時刻までは商品ページは「発売前」として公開され、
            時刻になると自動で購入できるようになります（手動での公開操作は不要）。
            複数商品を同じ時刻に一斉発売する場合は、商品一覧の「一斉発売設定」が便利です。時刻は日本時間です。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="発売開始日時（JST）"
              type="datetime-local"
              value={saleStartsLocal}
              onChange={(e) => setSaleStartsLocal(e.target.value)}
              hint="未設定なら即時販売"
            />
            <Input
              label="販売終了日時（JST）"
              type="datetime-local"
              value={saleEndsLocal}
              onChange={(e) => setSaleEndsLocal(e.target.value)}
              hint="未設定なら無期限"
            />
          </div>
          {(saleStartsLocal || saleEndsLocal) && (
            <button
              type="button"
              onClick={() => {
                setSaleStartsLocal('');
                setSaleEndsLocal('');
              }}
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              販売期間をクリア
            </button>
          )}
        </CardBody>
      </Card>

      {/* ---- 配送方法 (BASE の「送料詳細設定 App」相当) ---- */}
      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">配送方法・送料</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          {activeShipping.length === 0 ? (
            <p className="text-xs text-slate-500">
              配送方法が登録されていません。「配送方法設定」からネコポス・宅急便コンパクト・宅急便などを登録すると、ここで商品ごとに選べます。
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                この商品で使える配送方法にチェックを入れてください（サイズに応じて ネコポス / 宅急便コンパクト / 宅急便 など）。
                購入者はカート内の全商品が対応する配送方法から選びます。
              </p>
              <div className="space-y-2">
                {activeShipping.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={shippingIds.includes(m.id)}
                      onChange={() => toggleShipping(m.id)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                    />
                    <span>{m.name}</span>
                    <span className="text-xs text-slate-500">
                      {m.fee === 0 ? '送料無料' : `全国一律 ${formatJpy(m.fee)}`}
                    </span>
                    {m.isDefault && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        基本配送
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {shippingIds.length === 0 && (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  ※ 配送方法が一つも選ばれていない商品には、基本配送
                  {defaultShipping.length > 0
                    ? `（${defaultShipping.map((m) => m.name).join(' / ')}）`
                    : ''}
                  が適用されます。
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {error && (
        <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {mode === 'create' ? '商品を作成' : '変更を保存'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/admin/products')}
        >
          一覧へ戻る
        </Button>
      </div>
      {mode === 'create' && (
        <p className="mt-2 text-xs text-slate-500">
          作成後に、商品詳細ページでサイズ・カラーなどの「バリエーション（在庫）」を登録できます。
        </p>
      )}
    </form>
  );
}
