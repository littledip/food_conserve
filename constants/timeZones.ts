// A curated shortlist rather than the full ~400-entry IANA database.
//
// `Intl.supportedValuesOf('timeZone')` would enumerate everything, but it is
// not dependably available on Hermes across platforms, and a 400-row picker is
// poor UX on a phone anyway. This covers the zones a household is realistically
// in; the store accepts any IANA string, so the list can grow (or be replaced
// by a searchable picker) without a data migration.
export const COMMON_TIME_ZONES: { id: string; label: string }[] = [
  { id: 'America/New_York', label: 'Eastern (New York)' },
  { id: 'America/Chicago', label: 'Central (Chicago)' },
  { id: 'America/Denver', label: 'Mountain (Denver)' },
  { id: 'America/Phoenix', label: 'Mountain, no DST (Phoenix)' },
  { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { id: 'America/Toronto', label: 'Eastern Canada (Toronto)' },
  { id: 'America/Mexico_City', label: 'Mexico City' },
  { id: 'Europe/London', label: 'UK (London)' },
  { id: 'Europe/Dublin', label: 'Ireland (Dublin)' },
  { id: 'Europe/Paris', label: 'Central Europe (Paris)' },
  { id: 'Europe/Berlin', label: 'Central Europe (Berlin)' },
  { id: 'Europe/Madrid', label: 'Spain (Madrid)' },
  { id: 'Asia/Tokyo', label: 'Japan (Tokyo)' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Kolkata', label: 'India (Kolkata)' },
  { id: 'Australia/Sydney', label: 'Australia (Sydney)' },
  { id: 'UTC', label: 'UTC' },
];

// Label for a stored value, falling back to the raw id so a zone set outside
// the curated list still renders meaningfully instead of looking unset.
export function describeTimeZone(timeZone: string | null): string {
  if (!timeZone) return 'Device default';
  return COMMON_TIME_ZONES.find((z) => z.id === timeZone)?.label ?? timeZone;
}
