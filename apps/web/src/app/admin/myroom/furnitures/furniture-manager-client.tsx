'use client';

/**
 * MyRoom 家具マスタの管理 UI。
 *
 * 設計の方針:
 *  - 家具は「画像 + 名前 + 価格」が揃って初めて意味を持つので、1画面で
 *    追加からその場の画像アップロードまで完結させる（別画面に飛ばさない）。
 *  - 画像なしで「販売中」にしようとしたら止める。会員から見えない家具を
 *    作ってしまう事故がいちばん起きやすいため、UI とサーバー両方で防ぐ。
 *  - 削除は確認を挟む。家具は再作成に画像の再アップロードが必要で、
 *    取り消せない操作だから。
 */
import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Plus, Upload, Trash2, AlertTriangle, Pencil, X, EyeOff } from 'lucide-react';
import {
  MYROOM_FURNITURE_CATEGORIES,
  MYROOM_FURNITURE_CATEGORY_LABELS,
  MYROOM_FURNITURE_CATEGORY_DESCRIPTIONS,
  MYROOM_FURNITURE_STATUSES,
  MYROOM_FURNITURE_STATUS_LABELS,
  MYROOM_FURNITURE_NAME_MAX,
  MYROOM_FURNITURE_DESCRIPTION_MAX,
  MYROOM_FURNITURE_PUI_COST_MAX,
  MYROOM_FURNITURE_CELLS_MAX,
  MAX_MYROOM_FURNITURE_IMAGE_BYTES,
  DEFAULT_MYROOM_FURNITURE_DRAFT,
  validateMyRoomFurnitureImage,
  formatMyRoomImageBytes,
  myRoomFurnitureWarning,
  type MyRoomFurnitureDraft,
  type MyRoomFurnitureCategory,
  type MyRoomFurnitureStatus,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';

export type FurnitureRow = {
  id: string;
  name: string;
  description: string | null;
  category: MyRoomFurnitureCategory;
  status: MyRoomFurnitureStatus;
  puiCost: number;
  widthCells: number;
  heightCells: number;
  sortOrder: number;
  imageUrl: string | null;
  sizeBytes: number | null;
  updatedAt: string;
};

type Props = {
  initialFurnitures: FurnitureRow[];
  myRoomVisible: boolean;
};

const API = '/api/admin/myroom/furnitures';

const STATUS_TONE: Record<MyRoomFurnitureStatus, 'gray' | 'success' | 'warning'> = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  ARCHIVED: 'gray',
};

export function FurnitureManagerClient({ initialFurnitures, myRoomVisible }: Props) {
  const [furnitures, setFurnitures] = useState<FurnitureRow[]>(initialFurnitures);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<MyRoomFurnitureDraft>(DEFAULT_MYROOM_FURNITURE_DRAFT);
  const [saving, setSaving] = useState(false);
  /** 編集中の家具 id（インライン編集）。null なら編集していない */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MyRoomFurnitureDraft | null>(null);
  /** 画像アップロード中の家具 id */
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  /** 削除確認中の家具 id */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | MyRoomFurnitureCategory>('ALL');

  /** 家具ごとの file input を持つ（1つを使い回すと連続アップロードで値が残る） */
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const visible = useMemo(
    () =>
      categoryFilter === 'ALL'
        ? furnitures
        : furnitures.filter((f) => f.category === categoryFilter),
    [furnitures, categoryFilter],
  );

  /** 「販売中なのに画像がない」家具の数。運営に気づかせるための集計 */
  const warningCount = useMemo(
    () => furnitures.filter((f) => myRoomFurnitureWarning(f) !== null).length,
    [furnitures],
  );

  const publishedCount = useMemo(
    () => furnitures.filter((f) => f.status === 'PUBLISHED' && f.imageUrl).length,
    [furnitures],
  );

  // -------------------------------------------------------------------------
  // 新規作成
  // -------------------------------------------------------------------------
  async function handleCreate() {
    const name = draft.name.trim();
    if (!name) {
      toast.error('家具の名前を入力してください');
      return;
    }
    // 画像は作成後にアップロードする流れなので、この時点で PUBLISHED は選べない。
    // （サーバー側でも弾くが、押してからエラーになるより先に止める）
    if (draft.status === 'PUBLISHED') {
      toast.error(
        '画像を登録する前に販売中にはできません。まず「準備中」で作成し、画像を登録してから販売中に切り替えてください。',
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, name, description: draft.description || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? '家具の追加に失敗しました');
      const created = json.furniture as FurnitureRow;
      setFurnitures((prev) => [{ ...created, sizeBytes: null }, ...prev]);
      setDraft(DEFAULT_MYROOM_FURNITURE_DRAFT);
      setCreating(false);
      toast.success(
        `「${created.name}」を追加しました。続けて画像を登録してください。`,
        '家具を追加',
      );
    } catch (e) {
      toast.error((e as Error).message, '追加エラー');
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // 更新（インライン編集 / 状態切り替え）
  // -------------------------------------------------------------------------
  async function patchFurniture(id: string, patch: Partial<MyRoomFurnitureDraft>) {
    const res = await fetch(`${API}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? '保存に失敗しました');
    const updated = json.furniture as FurnitureRow;
    setFurnitures((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updated, updatedAt: updated.updatedAt } : f)),
    );
    return updated;
  }

  async function handleSaveEdit(id: string) {
    if (!editDraft) return;
    const name = editDraft.name.trim();
    if (!name) {
      toast.error('家具の名前を入力してください');
      return;
    }
    setSaving(true);
    try {
      await patchFurniture(id, { ...editDraft, name, description: editDraft.description || null });
      setEditingId(null);
      setEditDraft(null);
      toast.success('家具の情報を保存しました');
    } catch (e) {
      toast.error((e as Error).message, '保存エラー');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(f: FurnitureRow, status: MyRoomFurnitureStatus) {
    // 画像がないまま販売中にしようとした場合は、サーバーに投げる前に止めて
    // 「なぜダメか」をその場で伝える。
    if (status === 'PUBLISHED' && !f.imageUrl) {
      toast.error(
        '画像が未設定のため販売中にできません。先に画像を登録してください。',
        '販売中にできません',
      );
      return;
    }
    setSaving(true);
    try {
      await patchFurniture(f.id, { status });
      toast.success(
        `「${f.name}」を${MYROOM_FURNITURE_STATUS_LABELS[status]}にしました`,
        status === 'PUBLISHED' ? '販売開始' : '状態を変更',
      );
    } catch (e) {
      toast.error((e as Error).message, '変更エラー');
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // 画像アップロード
  // -------------------------------------------------------------------------
  async function handleImageSelected(f: FurnitureRow, file: File | null) {
    if (!file) return;
    // サーバーへ送る前に同じ検証をかける。大きなファイルを無駄に
    // アップロードさせないため（共有ロジックなので判定は必ず一致する）。
    const check = validateMyRoomFurnitureImage({
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (!check.ok) {
      toast.error(check.message, '画像を登録できません');
      return;
    }
    setUploadingId(f.id);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API}/${f.id}/image`, { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? '画像の登録に失敗しました');
      const imageUrl = json.imageUrl as string;
      setFurnitures((prev) =>
        prev.map((x) =>
          x.id === f.id ? { ...x, imageUrl, sizeBytes: file.size } : x,
        ),
      );
      toast.success(
        f.imageUrl ? '画像を差し替えました' : '画像を登録しました。販売中に切り替えられます。',
        '画像を登録',
      );
    } catch (e) {
      toast.error((e as Error).message, '画像エラー');
    } finally {
      setUploadingId(null);
      // 同じファイルを続けて選び直せるように値をクリアする。
      const input = fileInputs.current[f.id];
      if (input) input.value = '';
    }
  }

  // -------------------------------------------------------------------------
  // 削除
  // -------------------------------------------------------------------------
  async function handleDelete(f: FurnitureRow) {
    setSaving(true);
    try {
      const res = await fetch(`${API}/${f.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? '削除に失敗しました');
      setFurnitures((prev) => prev.filter((x) => x.id !== f.id));
      setConfirmDeleteId(null);
      toast.success(`「${f.name}」を削除しました`, '家具を削除');
    } catch (e) {
      toast.error((e as Error).message, '削除エラー');
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">MyRoom 家具管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            会員が自分の部屋に置ける家具を登録します。会員は Pui を使って購入します。
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : 'primary'}>
          {creating ? (
            <>
              <X className="mr-1.5 h-4 w-4" aria-hidden />
              閉じる
            </>
          ) : (
            <>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              家具を追加
            </>
          )}
        </Button>
      </div>

      {/*
        MyRoom が非公開のあいだは、その事実を目立つ形で出す。
        「家具を登録したのに会員に見えない」という問い合わせを防ぐため、
        かつ「まだ公開しない」方針どおりであることを運営が確認できるように。
      */}
      {!myRoomVisible && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">MyRoom は現在「非公開」です（管理者だけが利用できます）</p>
            <p className="mt-1 text-amber-800">
              ここで登録した家具は、まだ一般会員には表示されません。会員に公開する準備ができたら
              <span className="font-medium">スーパー管理者 → 設定 → 公開設定</span>
              の「MyRoom（家具の部屋）」を ON にしてください。
              非公開のあいだも管理者は動作確認ができます。
            </p>
          </div>
        </div>
      )}

      {warningCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
          <div className="text-sm text-rose-900">
            <p className="font-semibold">
              画像が未設定のまま「販売中」になっている家具が {warningCount} 件あります
            </p>
            <p className="mt-1 text-rose-800">
              画像のない家具は会員側に表示されません。画像を登録してください。
            </p>
          </div>
        </div>
      )}

      {/* 新規作成フォーム */}
      {creating && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-800">家具を追加</h2>
            <p className="mt-1 text-xs text-slate-500">
              まず名前と価格を登録し、作成後に画像をアップロードします。
              画像を登録するまでは「準備中」のままになります。
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            <Input
              label="家具の名前"
              value={draft.name}
              maxLength={MYROOM_FURNITURE_NAME_MAX}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              hint={`${draft.name.length} / ${MYROOM_FURNITURE_NAME_MAX} 文字`}
              placeholder="ふわふわソファ"
            />
            <Textarea
              label="説明（任意）"
              value={draft.description ?? ''}
              maxLength={MYROOM_FURNITURE_DESCRIPTION_MAX}
              rows={2}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              hint={`${(draft.description ?? '').length} / ${MYROOM_FURNITURE_DESCRIPTION_MAX} 文字`}
              placeholder="会員向けショップに表示される説明文"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Select
                  label="分類"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      category: e.target.value as MyRoomFurnitureCategory,
                    }))
                  }
                >
                  {MYROOM_FURNITURE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {MYROOM_FURNITURE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-slate-500">
                  {MYROOM_FURNITURE_CATEGORY_DESCRIPTIONS[draft.category]}
                </p>
              </div>
              <Input
                label="価格（Pui）"
                type="number"
                min={0}
                max={MYROOM_FURNITURE_PUI_COST_MAX}
                value={draft.puiCost}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, puiCost: Number(e.target.value) || 0 }))
                }
                hint="0 にすると無料で配布できます"
              />
              <Input
                label="幅（マス）"
                type="number"
                min={1}
                max={MYROOM_FURNITURE_CELLS_MAX}
                value={draft.widthCells}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, widthCells: Number(e.target.value) || 1 }))
                }
              />
              <Input
                label="高さ（マス）"
                type="number"
                min={1}
                max={MYROOM_FURNITURE_CELLS_MAX}
                value={draft.heightCells}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, heightCells: Number(e.target.value) || 1 }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
                キャンセル
              </Button>
              <Button onClick={handleCreate} loading={saving}>
                追加する
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* 一覧 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                登録済みの家具（{furnitures.length} 件）
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                会員が購入できるのは「販売中」かつ画像のある家具だけです（現在 {publishedCount} 件）。
              </p>
            </div>
            <Select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as 'ALL' | MyRoomFurnitureCategory)
              }
              aria-label="分類でしぼりこむ"
            >
              <option value="ALL">すべての分類</option>
              {MYROOM_FURNITURE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MYROOM_FURNITURE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardBody>
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {furnitures.length === 0
                ? '家具がまだ登録されていません。「家具を追加」から始めてください。'
                : 'この分類の家具はありません。'}
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((f) => {
                const warning = myRoomFurnitureWarning(f);
                const isEditing = editingId === f.id;
                const isUploading = uploadingId === f.id;
                return (
                  <li
                    key={f.id}
                    className="rounded-lg border border-slate-200 p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-start gap-4">
                      {/* 画像プレビュー */}
                      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                        {f.imageUrl ? (
                          <Image
                            src={f.imageUrl}
                            alt={f.name}
                            fill
                            sizes="80px"
                            className="object-contain"
                            // 家具画像は外部 S3 にも DB 配信にも載るため最適化を通さない
                            // (next.config の remotePatterns 設定に依存させない)。
                            unoptimized
                          />
                        ) : (
                          <span className="flex h-full items-center justify-center px-1 text-center text-[10px] leading-tight text-slate-400">
                            画像
                            <br />
                            未設定
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        {isEditing && editDraft ? (
                          <div className="space-y-3">
                            <Input
                              label="家具の名前"
                              value={editDraft.name}
                              maxLength={MYROOM_FURNITURE_NAME_MAX}
                              onChange={(e) =>
                                setEditDraft((d) => (d ? { ...d, name: e.target.value } : d))
                              }
                            />
                            <Textarea
                              label="説明（任意）"
                              rows={2}
                              value={editDraft.description ?? ''}
                              maxLength={MYROOM_FURNITURE_DESCRIPTION_MAX}
                              onChange={(e) =>
                                setEditDraft((d) =>
                                  d ? { ...d, description: e.target.value } : d,
                                )
                              }
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Select
                                label="分類"
                                value={editDraft.category}
                                onChange={(e) =>
                                  setEditDraft((d) =>
                                    d
                                      ? {
                                          ...d,
                                          category: e.target
                                            .value as MyRoomFurnitureCategory,
                                        }
                                      : d,
                                  )
                                }
                              >
                                {MYROOM_FURNITURE_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {MYROOM_FURNITURE_CATEGORY_LABELS[c]}
                                  </option>
                                ))}
                              </Select>
                              <Input
                                label="価格（Pui）"
                                type="number"
                                min={0}
                                max={MYROOM_FURNITURE_PUI_COST_MAX}
                                value={editDraft.puiCost}
                                onChange={(e) =>
                                  setEditDraft((d) =>
                                    d
                                      ? { ...d, puiCost: Number(e.target.value) || 0 }
                                      : d,
                                  )
                                }
                              />
                              <Input
                                label="幅（マス）"
                                type="number"
                                min={1}
                                max={MYROOM_FURNITURE_CELLS_MAX}
                                value={editDraft.widthCells}
                                onChange={(e) =>
                                  setEditDraft((d) =>
                                    d
                                      ? { ...d, widthCells: Number(e.target.value) || 1 }
                                      : d,
                                  )
                                }
                              />
                              <Input
                                label="高さ（マス）"
                                type="number"
                                min={1}
                                max={MYROOM_FURNITURE_CELLS_MAX}
                                value={editDraft.heightCells}
                                onChange={(e) =>
                                  setEditDraft((d) =>
                                    d
                                      ? { ...d, heightCells: Number(e.target.value) || 1 }
                                      : d,
                                  )
                                }
                              />
                              <Input
                                label="並び順"
                                type="number"
                                min={0}
                                value={editDraft.sortOrder}
                                onChange={(e) =>
                                  setEditDraft((d) =>
                                    d
                                      ? { ...d, sortOrder: Number(e.target.value) || 0 }
                                      : d,
                                  )
                                }
                                hint="小さいほど先に表示されます"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditDraft(null);
                                }}
                                disabled={saving}
                              >
                                キャンセル
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleSaveEdit(f.id)}
                                loading={saving}
                              >
                                保存
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium text-slate-900">
                                {f.name}
                              </span>
                              <Badge tone={STATUS_TONE[f.status]}>
                                {MYROOM_FURNITURE_STATUS_LABELS[f.status]}
                              </Badge>
                              <Badge tone="info">
                                {MYROOM_FURNITURE_CATEGORY_LABELS[f.category]}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {f.puiCost === 0 ? '無料' : `${f.puiCost.toLocaleString()} Pui`}
                              {' ・ '}
                              {f.widthCells}×{f.heightCells} マス
                              {' ・ '}並び順 {f.sortOrder}
                              {f.sizeBytes ? ` ・ ${formatMyRoomImageBytes(f.sizeBytes)}` : ''}
                            </p>
                            {f.description && (
                              <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                                {f.description}
                              </p>
                            )}
                            {warning && (
                              <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-rose-700">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                                {warning}
                              </p>
                            )}
                          </>
                        )}
                      </div>

                      {/* 操作 */}
                      {!isEditing && (
                        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-col sm:items-stretch">
                          <Select
                            value={f.status}
                            onChange={(e) =>
                              handleStatusChange(
                                f,
                                e.target.value as MyRoomFurnitureStatus,
                              )
                            }
                            disabled={saving}
                            aria-label={`${f.name} の状態`}
                          >
                            {MYROOM_FURNITURE_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {MYROOM_FURNITURE_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </Select>

                          <input
                            ref={(el) => {
                              fileInputs.current[f.id] = el;
                            }}
                            type="file"
                            accept="image/png,image/webp,image/jpeg"
                            className="hidden"
                            onChange={(e) =>
                              handleImageSelected(f, e.target.files?.[0] ?? null)
                            }
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            loading={isUploading}
                            onClick={() => fileInputs.current[f.id]?.click()}
                          >
                            <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            {f.imageUrl ? '画像を差し替え' : '画像を登録'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingId(f.id);
                              setEditDraft({
                                name: f.name,
                                description: f.description,
                                category: f.category,
                                status: f.status,
                                puiCost: f.puiCost,
                                widthCells: f.widthCells,
                                heightCells: f.heightCells,
                                sortOrder: f.sortOrder,
                              });
                            }}
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            編集
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600 hover:bg-rose-50"
                            onClick={() => setConfirmDeleteId(f.id)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            削除
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* 削除の確認。取り消せない操作なので必ず一段挟む */}
                    {confirmDeleteId === f.id && (
                      <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-3">
                        <p className="text-sm font-semibold text-rose-900">
                          「{f.name}」を削除しますか？
                        </p>
                        <p className="mt-1 text-xs text-rose-800">
                          家具のデータと画像をまとめて削除します。この操作は取り消せません。
                          一時的に売りたくないだけであれば、状態を「販売終了」にしてください。
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={saving}
                          >
                            やめる
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDelete(f)}
                            loading={saving}
                          >
                            削除する
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-slate-400">
        画像は PNG・WebP・JPEG（{formatMyRoomImageBytes(MAX_MYROOM_FURNITURE_IMAGE_BYTES)}
        まで）。家具は背景を透過できる PNG か WebP をおすすめします。
      </p>
    </div>
  );
}
