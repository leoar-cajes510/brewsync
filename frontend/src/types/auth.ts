// Staff accounts (Admin → Staff), loaded from and saved to /staff.
// Passwords are validated in the form and then DISCARDED — they are never
// kept in state, displayed, or sent anywhere. Real auth comes later.

export type StaffRole = 'Admin' | 'Cashier';
export type StaffStatus = 'Active' | 'Inactive';

export const STAFF_ROLES: StaffRole[] = ['Admin', 'Cashier'];

/** Terminal choices for the prototype. Not permanent terminal records. */
export const TERMINALS = ['Unassigned', 'REG-01', 'REG-02', 'REG-03', 'All Terminals'] as const;
export type Terminal = (typeof TERMINALS)[number];

export interface StaffActivity {
  id: string;
  at: Date;
  text: string;
}

export interface StaffMember {
  id: string;
  /** Display user ID, e.g. STF-01. */
  code: string;
  fullName: string;
  username: string;
  role: StaffRole;
  terminal: Terminal;
  status: StaffStatus;
  /** Sign-in method chosen by the Admin; resets issue a temporary credential of this type. */
  authMethod?: 'password' | 'pin';
  createdAt: Date;
  /** Null until real sign-in exists. */
  lastActiveAt: Date | null;
  /** When a password was last set/reset in this UI (the password itself is never stored). */
  passwordSetAt: Date;
  mustChangePassword: boolean;
  activity: StaffActivity[];
}

export interface StaffDraft {
  fullName: string;
  username: string;
  role: StaffRole;
  terminal: Terminal;
  status: StaffStatus;
}

export interface PasswordRule {
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { label: 'Contains a letter', test: (pw) => /[a-z]/i.test(pw) },
  { label: 'Contains a number', test: (pw) => /\d/.test(pw) },
];

export const passwordValid = (pw: string) => PASSWORD_RULES.every((r) => r.test(pw));

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,20}$/;
