import type { Entry } from './notebook';

export function entriesToJSON(entries: Entry[]): string {
  return JSON.stringify(entries, null, 2);
}

function escapeCsvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function entriesToCSV(entries: Entry[]): string {
  const headers = [
    'timestamp',
    'simTime',
    'action',
    'vesselId',
    'details',
    'reaction',
    'tempK',
    'pH',
    'pressureKPa',
    'hazards',
  ];

  const rows = [headers.join(',')];
  for (const e of entries) {
    const row = [
      escapeCsvCell(e.timestamp),
      escapeCsvCell(e.simTime !== undefined ? e.simTime.toFixed(2) : ''),
      escapeCsvCell(e.action),
      escapeCsvCell(e.vesselId ?? ''),
      escapeCsvCell(e.details),
      escapeCsvCell(e.reaction ?? ''),
      escapeCsvCell(e.tempK !== undefined ? e.tempK.toFixed(2) : ''),
      escapeCsvCell(e.pH !== undefined ? e.pH.toFixed(2) : ''),
      escapeCsvCell(e.pressureKPa !== undefined ? e.pressureKPa.toFixed(2) : ''),
      escapeCsvCell(e.hazards ? e.hazards.join(';') : ''),
    ];
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
