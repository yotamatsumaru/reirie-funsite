/**
 * 景品交換カタログ + 交換済みデジタル特典ダウンロード をまとめる親 Client Component。
 *  - RewardsClient で DIGITAL を交換すると refreshKey を更新し、
 *    DigitalDownloads を即時に再取得させる。
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

export function RewardsSection({
  items,
  balance,
  defaultShipping,
}: {
  items: CatalogItem[];
  balance: number;
  defaultShipping: ShippingInfo;
}) {
  const [downloadRefreshKey, setDownloadRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <DigitalDownloads refreshKey={downloadRefreshKey} />
      <RewardsClient
        items={items}
        balance={balance}
        defaultShipping={defaultShipping}
        onRedeemed={(kind) => {
          if (kind === 'DIGITAL') setDownloadRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
