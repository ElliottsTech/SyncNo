'use client';
import { useEffect } from 'react';

// Sets document.title — affects browser history entry label.
// Pass null/undefined to skip (e.g. while data still loading).
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
