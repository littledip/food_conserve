import {
  useProfileStore,
  greetingName,
  greetingFor,
  timeOfDay,
  displayName,
  initials,
} from '../stores/profileStore';
import { EMPTY_PROFILE, type HouseholdProfile } from '../types/profile';

const profile = (overrides: Partial<HouseholdProfile> = {}): HouseholdProfile => ({
  ...EMPTY_PROFILE,
  ...overrides,
});

describe('greetingName', () => {
  it('is the first name when set', () => {
    expect(greetingName(profile({ firstName: 'Sarah' }))).toBe('Sarah');
  });

  it('is null when unset, so the greeting can omit it entirely', () => {
    expect(greetingName(profile())).toBeNull();
    expect(greetingName(profile({ lastName: 'Hughes' }))).toBeNull();
  });
});

describe('displayName', () => {
  it('abbreviates the last name to an initial', () => {
    expect(displayName(profile({ firstName: 'Sarah', lastName: 'Hughes' }))).toBe('Sarah H.');
  });

  it('uses whichever single name is available', () => {
    expect(displayName(profile({ firstName: 'Sarah' }))).toBe('Sarah');
    expect(displayName(profile({ lastName: 'Hughes' }))).toBe('Hughes');
  });

  it('prompts setup rather than rendering blank when empty', () => {
    expect(displayName(profile())).toBe('Set up your profile');
  });
});

describe('initials', () => {
  it('uppercases both initials', () => {
    expect(initials(profile({ firstName: 'sarah', lastName: 'hughes' }))).toBe('SH');
  });

  it('returns a single initial when only one name is set', () => {
    expect(initials(profile({ firstName: 'Sarah' }))).toBe('S');
  });

  it('never returns an empty string', () => {
    expect(initials(profile())).toBe('—');
  });
});

describe('profileStore actions', () => {
  beforeEach(() => {
    useProfileStore.getState().resetProfile();
  });

  it('starts empty, with timeZone following the device', () => {
    expect(useProfileStore.getState().timeZone).toBeNull();
    expect(useProfileStore.getState().firstName).toBe('');
  });

  it('patches a single field without disturbing the others', () => {
    useProfileStore.getState().setProfile({ firstName: 'Sarah', lastName: 'Hughes' });
    useProfileStore.getState().setProfile({ householdName: 'The Hughes Kitchen' });
    const s = useProfileStore.getState();
    expect(s.firstName).toBe('Sarah');
    expect(s.lastName).toBe('Hughes');
    expect(s.householdName).toBe('The Hughes Kitchen');
  });

  it('trims surrounding whitespace', () => {
    useProfileStore.getState().setProfile({ firstName: '  Sarah  ' });
    expect(useProfileStore.getState().firstName).toBe('Sarah');
  });

  it('normalizes a whitespace-only or empty timeZone back to null (follow device)', () => {
    useProfileStore.getState().setProfile({ timeZone: 'America/New_York' });
    expect(useProfileStore.getState().timeZone).toBe('America/New_York');
    useProfileStore.getState().setProfile({ timeZone: '   ' });
    expect(useProfileStore.getState().timeZone).toBeNull();
    useProfileStore.getState().setProfile({ timeZone: 'America/New_York' });
    useProfileStore.getState().setProfile({ timeZone: null });
    expect(useProfileStore.getState().timeZone).toBeNull();
  });

  it('resetProfile clears every field', () => {
    useProfileStore.getState().setProfile({
      firstName: 'Sarah', lastName: 'Hughes',
      householdName: 'Kitchen', timeZone: 'Asia/Tokyo',
    });
    useProfileStore.getState().resetProfile();
    expect(useProfileStore.getState()).toMatchObject(EMPTY_PROFILE);
  });
});

describe('timeOfDay', () => {
  // Local-time constructor on purpose: the greeting follows the device clock,
  // so these must not be interpreted as UTC.
  const at = (hour: number) => new Date(2026, 10, 2, hour, 30);

  it('is morning from midnight until noon', () => {
    expect(timeOfDay(at(0))).toBe('morning');
    expect(timeOfDay(at(11))).toBe('morning');
  });

  it('is afternoon from noon until 5pm', () => {
    expect(timeOfDay(at(12))).toBe('afternoon');
    expect(timeOfDay(at(16))).toBe('afternoon');
  });

  it('is evening from 5pm until midnight', () => {
    expect(timeOfDay(at(17))).toBe('evening');
    expect(timeOfDay(at(23))).toBe('evening');
  });

  it('switches exactly on the hour boundaries', () => {
    expect(timeOfDay(new Date(2026, 10, 2, 11, 59))).toBe('morning');
    expect(timeOfDay(new Date(2026, 10, 2, 12, 0))).toBe('afternoon');
    expect(timeOfDay(new Date(2026, 10, 2, 16, 59))).toBe('afternoon');
    expect(timeOfDay(new Date(2026, 10, 2, 17, 0))).toBe('evening');
  });
});

describe('greetingFor', () => {
  const at = (hour: number) => new Date(2026, 10, 2, hour, 30);

  it('includes the first name when set', () => {
    expect(greetingFor(profile({ firstName: 'Sarah' }), at(9))).toBe('Good morning, Sarah');
    expect(greetingFor(profile({ firstName: 'Sarah' }), at(14))).toBe('Good afternoon, Sarah');
    expect(greetingFor(profile({ firstName: 'Sarah' }), at(20))).toBe('Good evening, Sarah');
  });

  it('omits the name and the comma when no first name is set', () => {
    expect(greetingFor(profile(), at(9))).toBe('Good morning');
    expect(greetingFor(profile({ lastName: 'Hughes' }), at(20))).toBe('Good evening');
  });
});
