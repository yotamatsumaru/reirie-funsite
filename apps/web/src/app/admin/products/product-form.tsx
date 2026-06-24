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

export type CategoryOption = { id: string; name: string };

export type ProductFormValues = {
  slug: string;
  name: string;
  description: string;
  basePrice: number;
  memberPrice: string;
  premiumPrice: string;
  categoryId: string;
  isActive: boolean;
  isMembersOnly: boolean;
  isPremiumExclusive: boolean;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function ProductForm({
  mode,
  productId,
  categories,
  initial,
}: {
  mode: 'create' | 'edit';
  productId?: string;
  categories: CategoryOption[];
  initial?: Partial<ProductFormValues>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
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

  function handleNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('商品名を入力してください。');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('slug は英小文字・数字・ハイフンのみで入力してください（例: t-shirt-2026）。');
      return;
    }
    const basePriceNum = Number(basePrice);
    if (!Number.isInteger(basePriceNum) || basePriceNum < 0) {
      setError('基本価格は 0 以上の整数で入力してください。');
      return;
    }

    const payload: Record<string, unknown> = {
      slug,
      name: name.trim(),
      description: description.trim() || undefined,
      basePrice: basePriceNum,
      memberPrice: memberPrice !== '' ? Number(memberPrice) : undefined,
      premiumPrice: premiumPrice !== '' ? Number(premiumPrice) : undefined,
      categoryId: categoryId || undefined,
      isActive,
      isMembersOnly,
      isPremiumExclusive,
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
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="例: 推しTシャツVer.2026"
            required
          />
          <Input
            label="slug (URL に使われる識別子)"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="oshi-tshirt-2026"
            hint="英小文字・数字・ハイフンのみ。商品名から自動生成されます。"
            required
          />
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
