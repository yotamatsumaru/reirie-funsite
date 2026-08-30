/**
 * 景品交換カタログ + 交換済みデジタル特典ダウンロード をまとめる親 Client Component。
 *  - RewardsClient で DIGITAL を交換すると refreshKey を更新し、
 *    DigitalDownloads を即時に再取得させる。
 *  - redeemedCatalogItemIds は交換済み判定 (重複交換の防止) 用。
 *    交換直後は router.refresh() を待たずに UI を「交換済み」へ切り替えたいので、
 *    サーバから受け取った初期値をローカル state で上書き可能にしている。
 */
'use client';

import { useState } from 'react';
import { RewardsClient } from './rewards-client';
import { DigitalDownloads } from './digital-downloads';

type CatalogItem = {
  id: string;
  slug: string;
  kind: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  puiCost: number;
  stock: number | null;
};

type ShippingInfo = {
  shippingName: string;
  shippingPhone: string;
  shippingPostalCode: string;
  shippingPrefecture: string;
  shippingAddress1: string;
  shippingAddress2: string;
};

/** 交換済みデジタル特典セクションへのアンカー id (「再ダウンロードへ」リンクの飛び先)。 */
export const DIGITAL_DOWNLOADS_ANCHOR = 'digital-downloads';

export function RewardsSection({
  items,
  balance,
  defaultShipping,
  redeemedCatalogItemIds,
}: {
  items: CatalogItem[];
  balance: number;
  defaultShipping: ShippingInfo;
  redeemedCatalogItemIds: string[];
}) {
  const [downloadRefreshKey, setDownloadRefreshKey] = useState(0);
  const [redeemedIds, setRedeemedIds] = useState<string[]>(redeemedCatalogItemIds);

  return (
    <div className="space-y-6">
      <DigitalDownloads refreshKey={downloadRefreshKey} anchorId={DIGITAL_DOWNLOADS_ANCHOR} />
      <RewardsClient
        items={items}
        balance={balance}
        defaultShipping={defaultShipping}
        redeemedCatalogItemIds={redeemedIds}
        downloadsAnchorId={DIGITAL_DOWNLOADS_ANCHOR}
        onRedeemed={(kind, catalogItemId) => {
          // 交換した時点で即「交換済み」にする。二度押しでの重複交換を UI でも防ぐ。
          setRedeemedIds((ids) => (ids.includes(catalogItemId) ? ids : [...ids, catalogItemId]));
          if (kind === 'DIGITAL') setDownloadRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
