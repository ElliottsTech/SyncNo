'use client';
import { useState, useEffect } from 'react';

const API = '/api';

export default function UsersPage() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch(`${API}/users`)
      .then(r => r.json())
      .then(setUsers);
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'Z');
    return date.toLocaleString();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Users</h1>
      <div className="bg-white rounded border overflow-hidden">
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
            {users.map((user: any) => (
              <tr key={user.id}>
                <td className="px-4 py-3 text-sm">{user.name || 'N/A'}</td>
                <td className="px-4 py-3 text-sm">{user.email}</td>
                <td className="px-4 py-3 text-sm">{user.role}</td>
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
