/**
 * Scenario form (create / edit) — JSON エディタ付き
 *
 * - script JSON は textarea に直書き (専用 GUI は将来拡張)
 * - 保存時に validateScenarioScript で検証 (サーバ側でも再検証)
 * - 検証エラーは details に列挙
 */
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Card, CardBody } from '@/components/ui/Card';
import { validateScenarioScript } from '@idol/shared';

interface ScenarioInitial {
  characterId: string;
  slug: string;
  chapterNumber: number;
  title: string;
  summary?: string | null;
  scriptJson?: unknown;
  priceJpy: number;
  isFreeTrial: boolean;
  isPremiumIncluded: boolean;
  status: string;
  requiredAffinity: number;
  estimatedMinutes?: number | null;
}

interface CharacterOption {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  mode: 'create' | 'edit';
  id?: string;
  initial?: Partial<ScenarioInitial>;
  characters: CharacterOption[];
  defaultCharacterId?: string;
}

const SAMPLE_SCRIPT = `{
  "version": 1,
  "startSceneKey": "opening",
  "scenes": {
    "opening": {
      "background": "bg_room",
      "bgm": "bgm_calm",
      "steps": [
        { "type": "narration", "text": "ある日のレッスン後 — 控室にて。" },
        { "type": "say", "speaker": "him", "expression": "smile",
          "text": "今日も来てくれてありがとう。" },
        { "type": "choice", "prompt": "どう答える?", "choices": [
          { "label": "もちろん!",
            "effects": [{ "type": "affinity", "delta": 3 }],
            "next": "happy" },
          { "label": "(無言で頷く)",
            "effects": [{ "type": "affinity", "delta": 1 }],
            "next": "happy" }
        ] }
      ]
    },
    "happy": {
      "steps": [
        { "type": "say", "speaker": "him", "text": "嬉しいな…また会おう。" },
        { "type": "end" }
      ]
    }
  }
}`;

export function ScenarioForm({ mode, id, initial, characters, defaultCharacterId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<{ ok: boolean; messages: string[] } | null>(null);
  const [form, setForm] = useState({
    characterId: initial?.characterId ?? defaultCharacterId ?? characters[0]?.id ?? '',
    slug: initial?.slug ?? '',
    chapterNumber: initial?.chapterNumber ?? 1,
    title: initial?.title ?? '',
    summary: initial?.summary ?? '',
    scriptJson: initial?.scriptJson ? JSON.stringify(initial.scriptJson, null, 2) : SAMPLE_SCRIPT,
    priceJpy: initial?.priceJpy ?? 0,
    isFreeTrial: initial?.isFreeTrial ?? false,
    isPremiumIncluded: initial?.isPremiumIncluded ?? false,
    status: initial?.status ?? 'DRAFT',
    requiredAffinity: initial?.requiredAffinity ?? 0,
    estimatedMinutes: initial?.estimatedMinutes ?? '',
  });

  const onChange = (k: keyof typeof form, v: unknown) =>
    setForm((s) => ({ ...s, [k]: v as never }));

  const handleValidate = () => {
    try {
      const parsed = JSON.parse(form.scriptJson);
      const v = validateScenarioScript(parsed);
      if (v.ok) {
        const sceneCount = Object.keys(v.script.scenes).length;
        const stepCount = Object.values(v.script.scenes).reduce(
          (sum, s) => sum + s.steps.length,
          0,
        );
        setValidateMsg({
          ok: true,
          messages: [`✓ 検証 OK (${sceneCount} シーン / ${stepCount} ステップ)`],
        });
      } else {
        setValidateMsg({ ok: false, messages: v.errors });
      }
    } catch (e) {
      setValidateMsg({ ok: false, messages: [`JSON 構文エラー: ${(e as Error).message}`] });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let scriptJson: unknown;
      try {
        scriptJson = JSON.parse(form.scriptJson);
      } catch (err) {
        throw new Error(`scriptJson が不正な JSON です: ${(err as Error).message}`);
      }

      const body = {
        characterId: form.characterId,
        slug: form.slug,
        chapterNumber: Number(form.chapterNumber),
        title: form.title,
        summary: form.summary || undefined,
        scriptJson,
        priceJpy: Number(form.priceJpy),
        isFreeTrial: form.isFreeTrial,
        isPremiumIncluded: form.isPremiumIncluded,
        status: form.status,
        requiredAffinity: Number(form.requiredAffinity),
        estimatedMinutes:
          form.estimatedMinutes === '' ? undefined : Number(form.estimatedMinutes),
      };

      const url = mode === 'create' ? '/api/admin/game/scenarios' : `/api/admin/game/scenarios/${id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j?.error?.message ?? '保存に失敗しました';
        const details =
          Array.isArray(j?.error?.details) && j.error.details.length
            ? `\n${j.error.details.join('\n')}`
            : '';
        throw new Error(msg + details);
      }
      const data = await res.json();
      if (mode === 'create') {
        router.push(`/admin/game/scenarios/${data.scenario.id}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!confirm('本当に削除しますか? (販売実績のある章はアーカイブされます)')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/game/scenarios/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      router.push('/admin/game/scenarios');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Select
              label="キャラクター"
              value={form.characterId}
              onChange={(e) => onChange('characterId', e.target.value)}
              required
              disabled={mode === 'edit'}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.slug})
                </option>
              ))}
            </Select>
            <Input
              label="章番号"
              type="number"
              value={form.chapterNumber}
              onChange={(e) => onChange('chapterNumber', e.target.value)}
              inputMode="numeric"
              required
            />
            <Input
              label="slug (英数+ハイフン)"
              value={form.slug}
              onChange={(e) => onChange('slug', e.target.value)}
              autoComplete="off"
              required
            />
            <Input
              label="タイトル"
              value={form.title}
              onChange={(e) => onChange('title', e.target.value)}
              required
            />
          </div>
          <Textarea
            label="あらすじ"
            rows={3}
            value={form.summary}
            onChange={(e) => onChange('summary', e.target.value)}
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input
              label="価格 (JPY)"
              type="number"
              value={form.priceJpy}
              onChange={(e) => onChange('priceJpy', e.target.value)}
              inputMode="numeric"
              hint="0 = 無料"
            />
            <Input
              label="解放に必要な親密度"
              type="number"
              value={form.requiredAffinity}
              onChange={(e) => onChange('requiredAffinity', e.target.value)}
              inputMode="numeric"
            />
            <Input
              label="プレイ目安 (分)"
              type="number"
              value={form.estimatedMinutes}
              onChange={(e) => onChange('estimatedMinutes', e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isFreeTrial}
                onChange={(e) => onChange('isFreeTrial', e.target.checked)}
                className="h-4 w-4"
              />
              無料体験 (プロローグ等)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isPremiumIncluded}
                onChange={(e) => onChange('isPremiumIncluded', e.target.checked)}
                className="h-4 w-4"
              />
              PREMIUM 会員に同梱
            </label>
            <Select
              label=""
              value={form.status}
              onChange={(e) => onChange('status', e.target.value)}
              className="w-auto"
            >
              <option value="DRAFT">DRAFT</option>
              <option value="PUBLISHED">PUBLISHED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </Select>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-semibold text-slate-700">
                シナリオ JSON (DSL)
              </label>
              <Button type="button" variant="outline" size="sm" onClick={handleValidate}>
                検証する
              </Button>
            </div>
            <textarea
              value={form.scriptJson}
              onChange={(e) => onChange('scriptJson', e.target.value)}
              className="block h-80 w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800"
              spellCheck={false}
            />
            {validateMsg && (
              <div
                className={`mt-2 rounded-md px-3 py-2 text-xs ${
                  validateMsg.ok
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                <ul className="space-y-0.5">
                  {validateMsg.messages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {error && (
            <p className="whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={busy}>
              {mode === 'create' ? '作成する' : '保存する'}
            </Button>
            {mode === 'edit' && (
              <Button type="button" variant="danger" onClick={handleDelete} disabled={busy}>
                削除 / アーカイブ
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
