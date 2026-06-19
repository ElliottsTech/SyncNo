'use client';
import { useState, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

interface ListState {
  page: number;
  sortCol: string | null;
  sortDir: 'asc' | 'desc' | null;
  columnFilters: Record<string, string>;
  search?: string;
}

export function useListState(
  defaults: Omit<ListState, 'columnFilters' | 'search'> & { columnFilters?: Record<string, string>; search?: string }
): [
  ListState,
  {
    setPage: (p: number) => void;
    setSort: (col: string | null, dir: 'asc' | 'desc' | null) => void;
    setFilters: (f: Record<string, string>) => void;
    setSearch?: (s: string) => void;
  }
] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const getInitial = <T>(key: string, defaultVal: T): T => {
    const val = searchParams.get(key);
    if (val === null) return defaultVal;
    try {
      return JSON.parse(val) as T;
    } catch {
      return defaultVal;
    }
  };

  const [state, setState] = useState<ListState>({
    page: getInitial('page', defaults.page),
    sortCol: getInitial('sortCol', defaults.sortCol),
    sortDir: getInitial('sortDir', defaults.sortDir),
    columnFilters: getInitial('columnFilters', defaults.columnFilters || {}),
    search: getInitial('search', defaults.search || ''),
  });

  const pushUrl = useCallback(
    (newState: Partial<ListState>) => {
      const merged = { ...state, ...newState };
      const params = new URLSearchParams();
      if (merged.page !== defaults.page) params.set('page', String(merged.page));
      if (merged.sortCol !== defaults.sortCol) params.set('sortCol', merged.sortCol || '');
      if (merged.sortDir !== defaults.sortDir) {
        params.set('sortDir', merged.sortDir || '');
      }
      if (merged.search) {
        params.set('search', merged.search);
      }
      if (merged.columnFilters && Object.keys(merged.columnFilters).length > 0) {
        const cleanFilters: Record<string, string> = {};
        for (const [k, v] of Object.entries(merged.columnFilters)) {
          if (v) cleanFilters[k] = v;
        }
        if (Object.keys(cleanFilters).length > 0) {
          params.set('columnFilters', JSON.stringify(cleanFilters));
        }
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [state, defaults, pathname, router]
  );

  const setPage = useCallback(
    (p: number) => {
      setState(s => ({ ...s, page: p }));
      pushUrl({ page: p });
    },
    [pushUrl]
  );

  const setSort = useCallback(
    (col: string | null, dir: 'asc' | 'desc' | null) => {
      setState(s => ({ ...s, sortCol: col, sortDir: dir, page: 1 }));
      pushUrl({ sortCol: col, sortDir: dir, page: 1 });
    },
    [pushUrl]
  );

  const setFilters = useCallback(
    (f: Record<string, string>) => {
      setState(s => ({ ...s, columnFilters: f, page: 1 }));
      pushUrl({ columnFilters: f, page: 1 });
    },
    [pushUrl]
  );

  const setSearch = useCallback(
    (s: string) => {
      setState(st => ({ ...st, search: s, page: 1 }));
      pushUrl({ search: s, page: 1 });
    },
    [pushUrl]
  );

  return [state, { setPage, setSort, setFilters, setSearch }];
}
