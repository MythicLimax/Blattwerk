// Prüft eine eingegebene Seitenzahl gegen die Seitenanzahl des Dokuments.
export function parsePageNumber(input: string, pageCount: number): number | null {
  if (!/^\s*\d+\s*$/.test(input)) return null;
  const page = Number.parseInt(input, 10);
  return page >= 1 && page <= pageCount ? page : null;
}
