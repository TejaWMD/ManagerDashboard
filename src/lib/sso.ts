import { AUTHORIZED_USERS } from '../data/users';
import { UserAccount, UserRole } from '../types';

export const STORAGE_KEY_SESSION = 'wm_portal_active_user_v1';
export const STORAGE_KEY_PORTAL_URL = 'wm_portal_mainapp_url_v1';
export const DEFAULT_MAIN_APP_URL = 'https://tejawmd.github.io/MainApp/';

const VALID_ROLES: UserRole[] = ['account_manager', 'manager', 'admin'];
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SsoPayload {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  role_label?: string;
  department?: string;
  avatar_initials?: string;
  phone?: string;
  portal_url?: string;
  issued_at?: number;
}

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getMainAppUrl(): string {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY_PORTAL_URL);
    if (isValidHttpUrl(saved)) {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_MAIN_APP_URL;
}

export function redirectToMainApp(restricted = false): void {
  const baseUrl = getMainAppUrl();
  if (!restricted) {
    window.location.replace(baseUrl);
    return;
  }
  const separator = baseUrl.includes('?') ? '&' : '?';
  window.location.replace(`${baseUrl}${separator}restricted=true`);
}

const LEGACY_EMAIL_TO_USER_ID: Record<string, string> = {
  'wmdklmuugaa@gmail.com': 'mgr-1',
  'cs4@malayanfood.com': 'mgr-1',
  'wmdklawi@gmail.com': 'mgr-2',
  'cs3@malayanfood.com': 'mgr-2',
  'wmdkljay@gmail.com': 'mgr-3',
  'wmgjay09@gmail.com': 'mgr-3',
  'wmgtamil@gmail.com': 'mgr-4',
  'info@malayanfood.com': 'mgr-4',
};

function buildUserFromPayload(payload: SsoPayload): UserAccount | null {
  if (!payload || typeof payload !== 'object') return null;

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
  const role = payload.role as UserRole;

  if (!email || !id || !VALID_ROLES.includes(role)) {
    return null;
  }

  if (
    typeof payload.issued_at !== 'number' ||
    Number.isNaN(payload.issued_at) ||
    Math.abs(Date.now() - payload.issued_at) > MAX_TOKEN_AGE_MS
  ) {
    return null;
  }

  const mappedLegacyId = LEGACY_EMAIL_TO_USER_ID[email];
  const matched =
    AUTHORIZED_USERS.find(
      (u) =>
        u.id.toLowerCase() === id.toLowerCase() ||
        u.email.toLowerCase() === email ||
        (mappedLegacyId && u.id === mappedLegacyId)
    ) ||
    (rawName
      ? AUTHORIZED_USERS.find(
          (u) => u.name.trim().toLowerCase() === rawName.toLowerCase() && u.role === role
        )
      : undefined);

  const fallbackName = email.split('@')[0] || 'User';
  const name =
    (typeof payload.name === 'string' && payload.name.trim()) ||
    matched?.name ||
    fallbackName;

  const defaultRoleLabel =
    role === 'admin'
      ? 'Admin'
      : role === 'manager'
      ? 'Manager'
      : 'Account Manager';

  return {
    id: matched?.id || id,
    name,
    email: matched?.email || email,
    password: matched?.password || '',
    role,
    roleLabel:
      (typeof payload.role_label === 'string' && payload.role_label.trim()) ||
      matched?.roleLabel ||
      defaultRoleLabel,
    avatarInitials:
      (typeof payload.avatar_initials === 'string' && payload.avatar_initials.trim()) ||
      matched?.avatarInitials ||
      name.substring(0, 2).toUpperCase(),
    phone:
      (typeof payload.phone === 'string' ? payload.phone : '') ||
      matched?.phone ||
      '',
  };
}

export function resolveInitialSsoSession(): {
  user: UserAccount | null;
  isFreshSso: boolean;
} {
  try {
    const url = new URL(window.location.href);
    const ssoToken = url.searchParams.get('sso_token');

    if (ssoToken) {
      let decodedPayload: SsoPayload | null = null;
      try {
        const jsonStr = decodeURIComponent(atob(ssoToken));
        decodedPayload = JSON.parse(jsonStr) as SsoPayload;
      } catch {
        decodedPayload = null;
      }

      // Clean sso_token from URL immediately
      url.searchParams.delete('sso_token');
      window.history.replaceState({}, '', url.toString());

      const ssoUser = decodedPayload ? buildUserFromPayload(decodedPayload) : null;
      if (!ssoUser) {
        sessionStorage.removeItem(STORAGE_KEY_SESSION);
        return { user: null, isFreshSso: false };
      }

      sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(ssoUser));
      if (decodedPayload && isValidHttpUrl(decodedPayload.portal_url)) {
        sessionStorage.setItem(STORAGE_KEY_PORTAL_URL, decodedPayload.portal_url);
      }
      return { user: ssoUser, isFreshSso: true };
    }

    const saved = sessionStorage.getItem(STORAGE_KEY_SESSION);
    if (!saved) {
      return { user: null, isFreshSso: false };
    }
    const parsed = JSON.parse(saved) as UserAccount;
    if (
      parsed &&
      typeof parsed.email === 'string' &&
      parsed.email.trim() &&
      typeof parsed.id === 'string' &&
      parsed.id.trim() &&
      VALID_ROLES.includes(parsed.role)
    ) {
      return { user: parsed, isFreshSso: false };
    }
  } catch {
    // Ignore storage/URL errors
  }
  return { user: null, isFreshSso: false };
}
