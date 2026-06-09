'use client';

import { useEffect } from 'react';
import { useCartStore } from '@/stores/cart-store';

export function ClearCartOnMount() {
  const clear = useCartStore((s) => s.clear);
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}
