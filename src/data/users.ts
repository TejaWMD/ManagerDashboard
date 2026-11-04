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
  {
    id: 'mgr-5',
    name: 'Aizam',
    email: 'wmgaizam@gmail.com',
    password: '734599',
    role: 'manager',
    roleLabel: 'Manager',
    avatarInitials: 'AZ',
    phone: '',
  },
  {
    id: 'mgr-6',
    name: 'Usha',
    email: 'wmdusha@gmail.com',
    password: '589201',
    role: 'manager',
    roleLabel: 'Manager',
    avatarInitials: 'US',
    phone: '',
  },
  {
    id: 'mgr-7',
    name: 'Muttha',
    email: 'wmgmuttha@gmail.com',
    password: '364582',
    role: 'manager',
    roleLabel: 'Manager',
    avatarInitials: 'MT',
    phone: '',
  },

  // Admins
  {
    id: 'adm-1',
    name: 'Mr. Mani',
    email: 'admin1@gmail.com',
    password: '981834',
    role: 'admin',
    roleLabel: 'Admin',
    avatarInitials: 'MN',
    phone: '+601157350949',
  },
  {
    id: 'adm-2',
    name: 'Teja',
    email: 'wmgteja@gmail.com',
    password: '981834',
    role: 'admin',
    roleLabel: 'Admin',
    avatarInitials: 'TJ',
    phone: '',
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

export const CUSTOM_USERS_STORAGE_KEY = 'wm_portal_custom_users_v1';

export function getStoredCustomUsers(): UserAccount[] {
  try {
    const raw = localStorage.getItem(CUSTOM_USERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredCustomUser(user: UserAccount): void {
  try {
    const existing = getStoredCustomUsers();
    const filtered = existing.filter((u) => u.email.toLowerCase() !== user.email.toLowerCase());
    localStorage.setItem(CUSTOM_USERS_STORAGE_KEY, JSON.stringify([...filtered, user]));
  } catch {
    // ignore
  }
}

export function authenticateUser(
  emailInput: string,
  passwordInput: string,
  selectedRole: UserRole
): { success: boolean; user?: UserAccount; error?: string } {
  const normalizedEmail = emailInput.trim().toLowerCase();
  const trimmedPassword = passwordInput.trim();

  // 1. Check predefined authorized users
  const matchedUser = AUTHORIZED_USERS.find(
    (u) => u.email.toLowerCase() === normalizedEmail
  );

  if (matchedUser) {
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

  // 2. Check previously saved custom users
  const customUsers = getStoredCustomUsers();
  const matchedCustom = customUsers.find(
    (u) => u.email.toLowerCase() === normalizedEmail
  );

  if (matchedCustom) {
    if (matchedCustom.role !== selectedRole) {
      return {
        success: false,
        error: `Please select the ${matchedCustom.roleLabel} tab to sign in with this account.`,
      };
    }
    if (matchedCustom.password !== trimmedPassword) {
      return {
        success: false,
        error: 'Invalid password.',
      };
    }
    return {
      success: true,
      user: matchedCustom,
    };
  }

  // 3. Allow signing in with a new / different email on the fly
  const roleMeta = ROLE_META[selectedRole];
  const nameFromEmail = normalizedEmail.split('@')[0];
  const capitalizedName =
    nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1);
  const newAccount: UserAccount = {
    id: `custom-usr-${Date.now()}`,
    name: capitalizedName,
    email: normalizedEmail,
    password: trimmedPassword,
    role: selectedRole,
    roleLabel: roleMeta.title,
    avatarInitials: capitalizedName.substring(0, 2).toUpperCase(),
    phone: '',
  };

  saveStoredCustomUser(newAccount);

  return {
    success: true,
    user: newAccount,
  };
}
