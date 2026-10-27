export function formatDateTime(at: number): string {
  try {
    return new Date(at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  }
}
