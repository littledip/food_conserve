// Who is using the app, and the household they're tracking for. Separate from
// the pantry's own data: this is identity and settings, persisted under its
// own storage key, and it is the first thing in the codebase that models a
// user at all.
//
// `timeZone` is deliberately part of this object rather than read from the
// device. Day boundaries decide streak lengths and therefore Food Score
// values, so they need one authoritative value that a server can agree with —
// see docs/cloud-architecture.md §6.
export interface HouseholdProfile {
  firstName: string;
  lastName: string;
  householdName: string;
  // IANA zone id (e.g. "America/New_York"). null means "follow the device",
  // which is the current behavior and stays the default.
  timeZone: string | null;
}

export const EMPTY_PROFILE: HouseholdProfile = {
  firstName: '',
  lastName: '',
  householdName: '',
  timeZone: null,
};
