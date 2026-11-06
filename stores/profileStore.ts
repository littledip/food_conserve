import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_PROFILE, type HouseholdProfile } from '../types/profile';

// Identity and settings, kept in its own store (and its own AsyncStorage key)
// rather than bolted onto pantryStore: it has a different lifetime, is not
// event-sourced, and will not participate in the cloud event log the way
// pantry mutations will. See docs/cloud-architecture.md.

const PROFILE_STORAGE_KEY = 'food-conserve-profile/v1';

type ProfileState = HouseholdProfile & {
  // Patch semantics so a screen can update one field without restating the
  // rest. Strings are trimmed on the way in; blank stays blank rather than
  // becoming whitespace.
  setProfile: (patch: Partial<HouseholdProfile>) => void;
  resetProfile: () => void;
};

const normalize = (patch: Partial<HouseholdProfile>): Partial<HouseholdProfile> => {
  const next: Partial<HouseholdProfile> = {};
  if (patch.firstName !== undefined) next.firstName = patch.firstName.trim();
  if (patch.lastName !== undefined) next.lastName = patch.lastName.trim();
  if (patch.householdName !== undefined) next.householdName = patch.householdName.trim();
  if (patch.timeZone !== undefined) {
    const tz = patch.timeZone?.trim();
    next.timeZone = tz ? tz : null;
  }
  return next;
};

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      ...EMPTY_PROFILE,
      setProfile: (patch) => set((state) => ({ ...state, ...normalize(patch) })),
      resetProfile: () => set({ ...EMPTY_PROFILE }),
    }),
    {
      name: PROFILE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        firstName: state.firstName,
        lastName: state.lastName,
        householdName: state.householdName,
        timeZone: state.timeZone,
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<Record<keyof HouseholdProfile, unknown>>;
        const str = (v: unknown): string => (typeof v === 'string' ? v : '');
        return {
          ...currentState,
          firstName: str(p.firstName),
          lastName: str(p.lastName),
          householdName: str(p.householdName),
          timeZone: typeof p.timeZone === 'string' && p.timeZone ? p.timeZone : null,
        };
      },
    },
  ),
);

// --- Pure derivations (exported for testing; no store access) ---

// "Good morning, Sarah" needs a first name or nothing at all — never a
// dangling comma or the string "undefined".
export function greetingName(profile: HouseholdProfile): string | null {
  return profile.firstName || null;
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

// Deliberately reads the DEVICE clock, not the household timeZone. The
// greeting should match where the user physically is — someone travelling
// wants "Good evening" at their actual evening, not their household's.
// Day-boundary math for streaks and the Food Score is the opposite case and
// does belong to the household zone (docs/cloud-architecture.md §6).
export function timeOfDay(now: Date = new Date()): TimeOfDay {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// Full greeting line for the Home header. Recomputed on render rather than on
// a timer, so crossing noon while the screen sits open won't update it until
// something else re-renders — not worth an interval for a cosmetic string.
export function greetingFor(profile: HouseholdProfile, now: Date = new Date()): string {
  const base = `Good ${timeOfDay(now)}`;
  const name = greetingName(profile);
  return name ? `${base}, ${name}` : base;
}

// Profile header: "Sarah H." when both parts exist, first name alone when
// only that is set, and a neutral placeholder when the profile is empty.
export function displayName(profile: HouseholdProfile): string {
  const { firstName, lastName } = profile;
  if (firstName && lastName) return `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
  if (firstName) return firstName;
  if (lastName) return lastName;
  return 'Set up your profile';
}

// Avatar initials. Falls back to a single dash rather than empty so the
// avatar circle never renders blank.
export function initials(profile: HouseholdProfile): string {
  const a = profile.firstName.charAt(0).toUpperCase();
  const b = profile.lastName.charAt(0).toUpperCase();
  return (a + b) || '—';
}

// --- Selector hooks ---

export const useProfile = (): HouseholdProfile =>
  useProfileStore(
    useShallow((s) => ({
      firstName: s.firstName,
      lastName: s.lastName,
      householdName: s.householdName,
      timeZone: s.timeZone,
    })),
  );

export const useSetProfile = () => useProfileStore((s) => s.setProfile);

// null means "follow the device." Day-boundary helpers treat that as their
// existing local-calendar behavior, so an unset profile changes nothing.
export const useHouseholdTimeZone = (): string | null =>
  useProfileStore((s) => s.timeZone);
