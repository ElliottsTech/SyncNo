'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import Pagination from '../../components/Pagination';
import AppointmentCalendar from '../../components/AppointmentCalendar';
import { useListState } from '../../lib/useUrlState';
import { usePageTitle } from '../../lib/usePageTitle';

const API = '/api';

export default function AppointmentsPage() {
  usePageTitle('Appointments — Syncno');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [appointments, setAppointments] = useState([]);
  const [allForCalendar, setAllForCalendar] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [listState, { setPage, setSort, setFilters }] = useListState({
    page: 1,
    sortCol: 'start_at',
    sortDir: 'desc',
    columnFilters: {},
  });

  const fetchList = useCallback(() => {
    setLoading(true);
    const { page, sortCol, sortDir, columnFilters } = listState;
    const sort = sortCol && sortDir ? `&sortCol=${sortCol}&sortDir=${sortDir}` : '';
    const colFilters = Object.entries(columnFilters)
      .filter(([_, v]) => v)
      .map(([k, v]) => `&filter_${k}=${encodeURIComponent(v)}`)
      .join('');
    fetch(`${API}/appointments?page=${page}&limit=50${sort}${colFilters}`)
      .then(r => r.json())
      .then(d => {
        setAppointments(d.data);
        setPagination(d.pagination);
        setLoading(false);
      });
  }, [listState]);

  const fetchAllForCalendar = useCallback(() => {
    fetch(`${API}/appointments?page=1&limit=500&sortCol=start_at&sortDir=desc`)
      .then(r => r.json())
      .then(d => setAllForCalendar(d.data || []));
  }, []);

  useEffect(() => {
    if (view === 'list') fetchList();
    else fetchAllForCalendar();
  }, [view, fetchList, fetchAllForCalendar]);

  const columns = [
    {
      key: 'summary',
      label: 'Summary',
      render: (v, row) => (
        <Link href={`/appointments/${row.id}`} className="text-blue-600 hover:underline font-medium">
          {v || '(untitled)'}
        </Link>
      ),
    },
    {
      key: 'start_at',
      label: 'Start',
      render: v => v ? new Date(v).toLocaleString() : '—',
    },
    { key: 'end_at', label: 'End', render: v => v ? new Date(v).toLocaleString() : '—' },
    { key: 'location', label: 'Location' },
    { key: 'all_day', label: 'All Day', render: v => v ? 'Yes' : 'No' },
    { key: 'created_at', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Appointments</h1>
        <div className="flex items-center gap-2">
          <Link href="/appointment_types" className="text-sm text-blue-600 hover:underline mr-4">Appointment Types →</Link>
          <div className="flex border rounded overflow-hidden">
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1 text-sm ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >List</button>
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-1 text-sm ${view === 'calendar' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >Calendar</button>
          </div>
        </div>
      </div>

      {view === 'list' ? (
        <>
          <DataTable
            columns={columns}
            data={appointments}
            serverSide
            sortCol={listState.sortCol}
            sortDir={listState.sortDir}
            onSortChange={(col, dir) => setSort(col, dir)}
            onFilterChange={setFilters}
            loading={loading}
            rowClassName={(row: any) => !row.synced ? 'bg-red-50' : ''}
          />
          <Pagination
            page={pagination.page}
            limit={pagination.limit}
            total={pagination.total}
            onPageChange={setPage}
          />
        </>
      ) : (
        <AppointmentCalendar
          appointments={allForCalendar}
          onApptClick={(id) => { window.location.href = `/appointments/${id}`; }}
        />
      )}
    </div>
  );
}
