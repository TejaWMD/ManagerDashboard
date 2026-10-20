import { UserAccount, UserRole } from '../types';

export const AUTHORIZED_USERS: UserAccount[] = [
  // Account Managers
  {
    id: 'am-1',
    name: 'Shakti (Account Manager)',
    email: 'wmdklshakti@gmail.com',
    password: '374992',
    role: 'account_manager',
    roleLabel: 'Account Manager',
    department: 'Client Accounts - KL',
    avatarInitials: 'SK',
  },
  {
    id: 'am-2',
    name: 'Kavita (Account Manager)',
    email: 'wmdklkavita@gmail.com',
    password: '459982',
    role: 'account_manager',
    roleLabel: 'Account Manager',
    department: 'Client Accounts - KL',
    avatarInitials: 'KV',
  },
  {
    id: 'am-3',
    name: 'Linda (Account Manager)',
    email: 'wmdkllinda@gmail.com',
    password: '100293',
    role: 'account_manager',
    roleLabel: 'Account Manager',
    department: 'Client Accounts - KL',
    avatarInitials: 'LD',
  },

  // Managers
  {
    id: 'mgr-1',
    name: 'Teja (Manager)',
    email: 'wmgteja@gmail.com',
    password: '180403',
    role: 'manager',
    roleLabel: 'Manager',
    department: 'Operations & Escalation Management',
    avatarInitials: 'TJ',
  },

  // Admin
  {
    id: 'adm-1',
    name: 'System Admin',
    email: 'admin1@gmail.com',
    password: '981834',
    role: 'admin',
    roleLabel: 'Administrator',
    department: 'Executive & System Administration',
    avatarInitials: 'AD',
  },
];

export const ROLE_META: Record<
  UserRole,
  {
    title: string;
    shortTitle: string;
    subtitle: string;
    badgeColor: string;
  }
> = {
  account_manager: {
    title: 'Account Manager Portal',
    shortTitle: 'Account Manager',
    subtitle: 'Log client issues, monitor SLA progress, and manage assigned client accounts.',
    badgeColor: '#2563eb',
  },
  manager: {
    title: 'Manager Operations Portal',
    shortTitle: 'Manager',
    subtitle: 'Review account manager submissions, assign resolutions, and oversee team metrics.',
    badgeColor: '#7c3aed',
  },
  admin: {
    title: 'Administrator Command Center',
    shortTitle: 'Admin',
    subtitle: 'Full system access, executive analytics, and complete complaint lifecycle control.',
    badgeColor: '#059669',
  },
};

/**
 * Strictly authenticates a user by ensuring:
 * 1. Email & password match an authorized account
 * 2. The account belongs to the selected role category
 */
export function authenticateUser(
  emailInput: string,
  passwordInput: string,
  selectedRole: UserRole
): { success: boolean; user?: UserAccount; error?: string } {
  const normalizedEmail = emailInput.trim().toLowerCase();
  const trimmedPassword = passwordInput.trim();

  const matchedUser = AUTHORIZED_USERS.find(
    (u) => u.email.toLowerCase() === normalizedEmail
  );

  if (!matchedUser) {
    return {
      success: false,
      error: 'Access Denied: This email is not registered in the system.',
    };
  }

  if (matchedUser.role !== selectedRole) {
    return {
      success: false,
      error: `Access Denied: "${matchedUser.email}" does not have ${ROLE_META[selectedRole].shortTitle} access. Please select the ${matchedUser.roleLabel} tab.`,
    };
  }

  if (matchedUser.password !== trimmedPassword) {
    return {
      success: false,
      error: 'Invalid password. Please verify your credentials and try again.',
    };
  }

  return {
    success: true,
    user: matchedUser,
  };
}
