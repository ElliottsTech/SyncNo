// Payment status logic shared across routes

export function getPaymentStatus(invoice) {
  if (invoice.is_paid) return 'paid';
  if (invoice.verified_paid) return 'verified_paid';
  if (invoice.tech_marked_paid) return 'tech_marked_paid';
  if (invoice.due_date && new Date(invoice.due_date) < new Date()) return 'overdue';
  return 'unpaid';
}
