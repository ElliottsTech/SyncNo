import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Syncno</h1>
      <p className="text-gray-600 mb-6">Syncro MSP Data Viewer</p>
      <div className="grid grid-cols-3 gap-4 max-w-2xl">
        <Link href="/customers" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Customers</h2>
          <p className="text-sm text-gray-500">View all customers</p>
        </Link>
        <Link href="/tickets" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Tickets</h2>
          <p className="text-sm text-gray-500">View all tickets</p>
        </Link>
        <Link href="/invoices" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Invoices</h2>
          <p className="text-sm text-gray-500">View all invoices</p>
        </Link>
        <Link href="/vendors" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Vendors</h2>
          <p className="text-sm text-gray-500">View vendors & POs</p>
        </Link>
        <Link href="/estimates" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Estimates</h2>
          <p className="text-sm text-gray-500">View all estimates</p>
        </Link>
        <Link href="/search" className="p-4 bg-white rounded-lg border hover:border-blue-500">
          <h2 className="font-semibold">Search</h2>
          <p className="text-sm text-gray-500">Search everything</p>
        </Link>
      </div>
    </div>
  );
}
