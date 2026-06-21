'use client';
import { useState, useMemo } from 'react';

export interface CalendarAppointment {
  id: number | string;
  summary?: string;
  start_at?: string;
  end_at?: string;
  all_day?: boolean | number;
  ticket_id?: number | string | null;
}

interface Props {
  appointments: CalendarAppointment[];
  onApptClick?: (id: number | string) => void;
  onDayClick?: (dateStr: string) => void;
}

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toDateKey(s?: string): string | null {
  if (!s) return null;
  // Slice to YYYY-MM-DD to avoid TZ shifts
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function fmtDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonthGrid(year: number, month: number): Date[] {
  // month: 0-11. Returns 42 dates (6 weeks) starting from Monday on/before the 1st.
  const first = new Date(year, month, 1);
  const dayOfWeekMon0 = (first.getDay() + 6) % 7; // 0=Mon ... 6=Sun
  const start = new Date(year, month, 1 - dayOfWeekMon0);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return days;
}

export default function AppointmentCalendar({ appointments, onApptClick, onDayClick }: Props) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const byDay = useMemo(() => {
    const map: Record<string, CalendarAppointment[]> = {};
    for (const a of appointments) {
      const key = toDateKey(a.start_at);
      if (!key) continue;
      (map[key] ||= []).push(a);
    }
    return map;
  }, [appointments]);

  const grid = useMemo(() => startOfMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const todayKey = fmtDateKey(today);

  const shift = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m);
    setViewYear(y);
  };

  return (
    <div className="bg-white rounded border">
      <div className="flex items-center justify-between p-3 border-b">
        <button
          onClick={() => shift(-1)}
          className="px-2 py-1 text-sm rounded hover:bg-gray-100"
          aria-label="Previous month"
        >‹</button>
        <span className="font-semibold">{monthLabel}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
            className="px-2 py-1 text-xs rounded hover:bg-gray-100 border"
          >Today</button>
          <button
            onClick={() => shift(1)}
            className="px-2 py-1 text-sm rounded hover:bg-gray-100"
            aria-label="Next month"
          >›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b bg-gray-50">
        {DAY_HEADERS.map(d => (
          <div key={d} className="px-2 py-1 text-xs text-gray-500 font-medium text-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map((d, i) => {
          const key = fmtDateKey(d);
          const inMonth = d.getMonth() === viewMonth;
          const isToday = key === todayKey;
          const dayAppts = byDay[key] || [];
          const visible = dayAppts.slice(0, 3);
          const overflow = dayAppts.length - visible.length;
          return (
            <div
              key={i}
              onClick={() => onDayClick?.(key)}
              className={`min-h-[90px] p-1 border-r border-b cursor-pointer hover:bg-blue-50 ${
                inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'
              } ${(i + 1) % 7 === 0 ? 'border-r-0' : ''}`}
            >
              <div className={`text-right text-xs ${isToday ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center ml-auto' : ''}`}>
                {d.getDate()}
              </div>
              <div className="mt-1 space-y-0.5">
                {visible.map(a => (
                  <button
                    key={a.id}
                    onClick={(e) => { e.stopPropagation(); onApptClick?.(a.id); }}
                    className="block w-full text-left text-[11px] truncate px-1 py-0.5 rounded bg-blue-100 text-blue-800 hover:bg-blue-200"
                    title={a.summary || '(untitled)'}
                  >
                    {a.ticket_id ? '🎫 ' : ''}{a.summary || '(untitled)'}
                  </button>
                ))}
                {overflow > 0 && (
                  <div className="text-[10px] text-gray-500 pl-1">+{overflow} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
