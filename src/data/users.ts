import { UserAccount, UserRole } from '../types';

export const AUTHORIZED_USERS: UserAccount[] = [
  // Account Managers
  {
    id: 'am-1',
    name: 'Shakti',
    email: 'wmdklshakti@gmail.com',
    password: '374992',
    role: 'account_manager',
    roleLabel: 'Account Manager',
    avatarInitials: 'SK',
    phone: '+60194167570',
  },
  {
    id: 'am-2',
    name: 'Kavita',
    email: 'wmdklkavita@gmail.com',
    password: '459982',
    role: 'account_manager',
    roleLabel: 'Account Manager',
    avatarInitials: 'KV',
    phone: '',
  },
  {
    id: 'am-3',
    name: 'Linda',
    email: 'wmdkllinda@gmail.com',
    password: '100293',
    role: 'account_manager',
    roleLabel: 'Account Manager',
    avatarInitials: 'LD',
    phone: '',
  },

  // Managers
  {
    id: 'mgr-1',
    name: 'Muugaa',
    email: 'cs4@malayanfood.com',
    password: '663489',
    role: 'manager',
    roleLabel: 'Manager',
    avatarInitials: 'MG',
    phone: '+601940017570',
  },
  {
    id: 'mgr-2',
    name: 'Awi',
    email: 'cs3@malayanfood.com',
    password: '534220',
    role: 'manager',
    roleLabel: 'Manager',
    avatarInitials: 'AW',
    phone: '',
  },
  {
    id: 'mgr-3',
    name: 'Jay',
    email: 'wmgjay09@gmail.com',
    password: '019288',
    role: 'manager',
    roleLabel: 'Manager',
    avatarInitials: 'JY',
    phone: '',
  },
  {
    id: 'mgr-4',
    name: 'Tamil',
    email: 'info@malayanfood.com',
    password: '750284',
    role: 'manager',
    roleLabel: 'Manager',
    avatarInitials: 'TM',
    phone: '',
  },

  // Admin
  {
    id: 'adm-1',
    name: 'Teja',
    email: 'admin1@gmail.com',
    password: '981834',
    role: 'admin',
    roleLabel: 'Admin',
    avatarInitials: 'AD',
    phone: '+601157350949',
  },
];

export const ROLE_META: Record<
  UserRole,
  {
    title: string;
    shortTitle: string;
    badgeColor: string;
  }
> = {
  account_manager: {
    title: 'Account Manager',
    shortTitle: 'Account Manager',
    badgeColor: '#0ea5e9',
  },
  manager: {
    title: 'Manager',
    shortTitle: 'Manager',
    badgeColor: '#4f46e5',
  },
  admin: {
    title: 'Admin',
    shortTitle: 'Admin',
    badgeColor: '#10b981',
  },
};

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
      error: 'Email not found.',
    };
  }

  if (matchedUser.role !== selectedRole) {
    return {
      success: false,
      error: `Please select the ${matchedUser.roleLabel} tab to sign in with this account.`,
    };
  }

  if (matchedUser.password !== trimmedPassword) {
    return {
      success: false,
      error: 'Invalid password.',
    };
  }

  return {
    success: true,
    user: matchedUser,
  };
}
