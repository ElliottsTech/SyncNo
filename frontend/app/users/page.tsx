'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

const API = '/api';

type User = {
  id: string;
  email: string;
  name: string | null;
  last_login: string | null;
  created_at: string | null;
  role: 'admin' | 'user';
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: session, status } = useSession();
  const router = useRouter();
  const currentUserId = session?.user?.id;

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/');
      return;
    }
    if (status !== 'authenticated') return;
    refresh();
  }, [status, session, router]);

  const refresh = () => {
    fetch(`${API}/users`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load');
        return r.json();
      })
      .then(setUsers)
      .catch(e => setError(e.message));
  };

  const changeRole = async (id: string, role: 'admin' | 'user') => {
    setSavingId(id);
    setError(null);
    try {
      const r = await fetch(`${API}/users/${encodeURIComponent(id)}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || 'Failed to update role');
      }
      setUsers(prev => prev.map(u => (u.id === id ? { ...u, role } : u)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'Z');
    return date.toLocaleString();
  };

  if (status === 'loading') {
    return <div className="p-6 text-gray-500">Loading...</div>;
  }
  if (session?.user?.role !== 'admin') {
    return null;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">SyncNo Users</h1>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded border overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h2 className="font-semibold">Users who can log into Syncno</h2>
          <p className="text-xs text-gray-500">Syncro technicians live in <a href="/syncro_users" className="text-blue-600 hover:underline">Syncro Users</a></p>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map(user => (
              <tr key={user.id}>
                <td className="px-4 py-3 text-sm">
                  {user.name || 'N/A'}
                  {user.id === currentUserId && (
                    <span className="ml-2 text-xs text-gray-400">(you)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm">{user.email}</td>
                <td className="px-4 py-3 text-sm">
                  <select
                    value={user.role}
                    disabled={savingId === user.id}
                    onChange={e => changeRole(user.id, e.target.value as 'admin' | 'user')}
                    className="border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-sm">{user.last_login ? formatDate(user.last_login) : 'Never'}</td>
                <td className="px-4 py-3 text-sm">{user.created_at ? formatDate(user.created_at) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
