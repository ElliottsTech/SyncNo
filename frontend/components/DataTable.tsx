'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  onRowClick?: (row: any) => void;
  emptyMessage?: string;
  // Server-side mode
  serverSide?: boolean;
  sortCol?: string | null;
  sortDir?: 'asc' | 'desc' | null;
  filters?: Record<string, string>;
  onSortChange?: (col: string, dir: 'asc' | 'desc' | null) => void;
  onFilterChange?: (filters: Record<string, string>) => void;
  loading?: boolean;
}

type SortDir = 'asc' | 'desc' | null;

export default function DataTable({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No data found',
  serverSide,
  sortCol,
  sortDir,
  filters: initialFilters,
  onSortChange,
  onFilterChange,
  loading,
}: DataTableProps) {
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters || {});
  const [showFilter, setShowFilter] = useState<Record<string, boolean>>({});
  const filterRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const filterTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleHeaderClick = useCallback((colKey: string) => {
    if (!serverSide) return;
    if (!onSortChange) return;

    if (sortCol === colKey) {
      if (sortDir === 'asc') onSortChange(colKey, 'desc');
      else if (sortDir === 'desc') onSortChange(colKey, null);
      else onSortChange(colKey, 'asc');
    } else {
      onSortChange(colKey, 'asc');
    }
  }, [serverSide, sortCol, sortDir, onSortChange]);

  const handleFilterChange = useCallback((colKey: string, value: string) => {
    const newFilters = { ...filters, [colKey]: value };
    setFilters(newFilters);

    if (serverSide && onFilterChange) {
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
      filterTimerRef.current = setTimeout(() => {
        onFilterChange(newFilters);
      }, 300);
    }
  }, [filters, serverSide, onFilterChange]);

  const handleFilterIconClick = useCallback((colKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFilter(prev => ({ ...prev, [colKey]: !prev[colKey] }));
    setTimeout(() => filterRefs.current[colKey]?.focus(), 50);
  }, []);

  // Client-side filter + sort
  let result = [...data];
  if (!serverSide) {
    for (const [col, val] of Object.entries(filters)) {
      if (val) {
        result = result.filter(row => {
          const cell = row[col];
          if (cell == null) return false;
          return String(cell).toLowerCase().includes(val.toLowerCase());
        });
      }
    }
    if (sortCol && sortDir) {
      result.sort((a, b) => {
        const av = a[sortCol!] ?? '';
        const bv = b[sortCol!] ?? '';
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
  }

  useEffect(() => () => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
  }, []);

  if (!data || data.length === 0) {
    return <p className="text-gray-500 py-8 text-center">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map(col => (
              <th key={col.key} className="px-4 py-3 text-left">
                <div className="flex items-center gap-1">
                  {col.sortable !== false && (
                    <button
                      onClick={() => handleHeaderClick(col.key)}
                      className="text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-gray-700 flex items-center gap-1"
                    >
                      {col.label}
                      <span className="inline-flex flex-col leading-none">
                        <span className={`text-xs ${sortCol === col.key && sortDir === 'asc' ? 'text-blue-600' : 'text-gray-300'}`}>▲</span>
                        <span className={`text-xs ${sortCol === col.key && sortDir === 'desc' ? 'text-blue-600' : 'text-gray-300'}`}>▼</span>
                      </span>
                    </button>
                  )}
                  <button
                    onClick={(e) => handleFilterIconClick(col.key, e)}
                    className="ml-1 text-gray-400 hover:text-gray-600"
                    title={`Filter ${col.label}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                  </button>
                </div>
                {showFilter[col.key] && (
                  <input
                    ref={(el) => { filterRefs.current[col.key] = el; }}
                    type="text"
                    placeholder={`Filter...`}
                    value={filters[col.key] || ''}
                    onChange={(e) => handleFilterChange(col.key, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 w-full text-xs border rounded px-2 py-1"
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">
                Loading...
              </td>
            </tr>
          ) : result.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            result.map((row, i) => (
              <tr
                key={row.id || i}
                className={onRowClick ? 'hover:bg-gray-50 cursor-pointer' : ''}
                onClick={() => onRowClick && onRowClick(row)}
              >
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3 text-sm text-gray-900">
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
