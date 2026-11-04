import { supabase } from './supabase';
import {
  UserTrelloIntegration,
  TrelloBoard,
  TrelloList,
  TrelloCard,
  TrelloCardAction,
} from '../types';

const LOCAL_STORAGE_API_KEY = 'wm_portal_trello_api_key_v1';
const LOCAL_STORAGE_INTEGRATION_PREFIX = 'wm_portal_trello_user_';
const LOCAL_STORAGE_DEFAULT_TOKEN = 'wm_portal_trello_default_token';

export const DEFAULT_TRELLO_API_KEY = '37488d863baa1417dafd9951a2556200';
export const DEFAULT_TRELLO_TOKEN =
  'ATTA4ff280f13a4adab3cfd1f540cdd0b8356cd0cb64f32daa3837911da811e3b613B810A599';

export function getTrelloApiKey(): string {
  const envKey = (import.meta.env.VITE_TRELLO_API_KEY || '').trim();
  if (envKey) return envKey;
  try {
    const cached = localStorage.getItem(LOCAL_STORAGE_API_KEY);
    if (cached) return cached.trim();
  } catch {
    // ignore
  }
  return DEFAULT_TRELLO_API_KEY;
}

export function getTrelloDefaultToken(): string {
  const envToken = (import.meta.env.VITE_TRELLO_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    const cached = localStorage.getItem(LOCAL_STORAGE_DEFAULT_TOKEN);
    if (cached) return cached.trim();
  } catch {
    // ignore
  }
  return DEFAULT_TRELLO_TOKEN;
}

export function isValidTrelloToken(
  token?: string | null,
  apiKey?: string | null
): boolean {
  if (!token) return false;
  const cleanToken = token.trim();
  const cleanKey = (apiKey || '').trim();
  if (!cleanToken || cleanToken === cleanKey) return false;
  return cleanToken.length >= 32;
}

// Fallback / Offline Mock Store for smooth UX when no live token is in .env
const FALLBACK_BOARD_STORAGE_KEY = 'wm_portal_trello_mock_store_v1';

interface FallbackStore {
  board: TrelloBoard;
  lists: TrelloList[];
  cards: TrelloCard[];
  actions: TrelloCardAction[];
}

export function getFallbackStore(): FallbackStore {
  try {
    const raw = localStorage.getItem(FALLBACK_BOARD_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.board && Array.isArray(parsed?.lists) && Array.isArray(parsed?.cards)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  const initial: FallbackStore = {
    board: {
      id: 'board-wmd-operations',
      name: 'WMD Operations & Client Tasks',
      url: 'https://trello.com',
      closed: false,
    },
    lists: [
      { id: 'list-todo', name: '📋 To Do / New Queries', idBoard: 'board-wmd-operations' },
      { id: 'list-inprogress', name: '⚡ In Progress', idBoard: 'board-wmd-operations' },
      { id: 'list-review', name: '⏳ Pending Review / SLA', idBoard: 'board-wmd-operations' },
      { id: 'list-done', name: '✅ Completed', idBoard: 'board-wmd-operations' },
    ],
    cards: [
      {
        id: 'card-sample-1',
        name: 'Urgent: Follow up on Query #1042 Delivery Delay',
        desc: 'Customer requested immediate confirmation for morning dispatch.',
        idList: 'list-todo',
        idBoard: 'board-wmd-operations',
        due: new Date(Date.now() + 86400000).toISOString(),
        dueComplete: false,
        labels: [{ id: 'lbl-1', name: 'High Priority', color: 'red' }],
        dateLastActivity: new Date().toISOString(),
      },
      {
        id: 'card-sample-2',
        name: 'Resolve billing discrepancy for Lotus Supermarket',
        desc: 'Review credit note attachment and coordinate with finance.',
        idList: 'list-inprogress',
        idBoard: 'board-wmd-operations',
        due: new Date(Date.now() + 172800000).toISOString(),
        dueComplete: false,
        labels: [{ id: 'lbl-2', name: 'Finance', color: 'blue' }],
        dateLastActivity: new Date().toISOString(),
      },
      {
        id: 'card-sample-3',
        name: 'Weekly client check-in report completed',
        desc: 'Summary compiled for monthly performance KPI.',
        idList: 'list-done',
        idBoard: 'board-wmd-operations',
        dueComplete: true,
        labels: [{ id: 'lbl-3', name: 'Completed', color: 'green' }],
        dateLastActivity: new Date().toISOString(),
      },
    ],
    actions: [],
  };

  try {
    localStorage.setItem(FALLBACK_BOARD_STORAGE_KEY, JSON.stringify(initial));
  } catch {
    // ignore
  }
  return initial;
}

export function saveFallbackStore(store: FallbackStore) {
  try {
    localStorage.setItem(FALLBACK_BOARD_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export async function saveTrelloApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  try {
    localStorage.setItem(LOCAL_STORAGE_API_KEY, trimmed);
  } catch {
    // ignore
  }
  try {
    await supabase.from('system_settings').upsert({
      key: 'trello_api_key',
      value: trimmed,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // ignore DB errors if table not created yet
  }
}

export async function loadTrelloApiKeyFromDb(): Promise<string> {
  const local = getTrelloApiKey();
  if (local) return local;
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'trello_api_key')
      .single();
    if (!error && data?.value) {
      try {
        localStorage.setItem(LOCAL_STORAGE_API_KEY, data.value.trim());
      } catch {
        // ignore
      }
      return data.value.trim();
    }
  } catch {
    // ignore
  }
  return '';
}

export function getTrelloAuthUrl(apiKey?: string): string {
  const activeKey = (apiKey || '').trim() || getTrelloApiKey();
  const appName = encodeURIComponent('WMD Manager Dashboard');
  return `https://trello.com/1/authorize?expiration=never&name=${appName}&scope=read,write&response_type=token&key=${activeKey}`;
}

export interface TrelloMemberProfile {
  id: string;
  username: string;
  fullName: string;
  avatarUrl?: string;
  email?: string;
}

export async function verifyTrelloToken(
  apiKey: string,
  token: string
): Promise<TrelloMemberProfile> {
  const cleanKey = apiKey.trim();
  const cleanToken = token.trim();
  if (!cleanKey || !cleanToken) {
    throw new Error('API Key and Token are required.');
  }

  const res = await fetch(
    `https://api.trello.com/1/members/me?fields=id,username,fullName,avatarUrl,email&key=${cleanKey}&token=${cleanToken}`
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      errorText || 'Failed to authenticate with Trello. Please check your token.'
    );
  }

  const data = await res.json();
  return {
    id: data.id,
    username: data.username,
    fullName: data.fullName || data.username,
    avatarUrl: data.avatarUrl || undefined,
    email: data.email || undefined,
  };
}

// ============================================================================
// Supabase & LocalStorage integration storage
// ============================================================================

export async function saveUserIntegration(
  integration: UserTrelloIntegration
): Promise<void> {
  try {
    localStorage.setItem(
      `${LOCAL_STORAGE_INTEGRATION_PREFIX}${integration.userId}`,
      JSON.stringify(integration)
    );
  } catch {
    // ignore
  }

  try {
    await supabase.from('user_trello_integrations').upsert({
      user_id: integration.userId,
      trello_member_id: integration.trelloMemberId,
      trello_username: integration.trelloUsername,
      trello_full_name: integration.trelloFullName,
      trello_email: integration.trelloEmail || null,
      trello_avatar_url: integration.trelloAvatarUrl || null,
      trello_token: integration.trelloToken,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not persist Trello integration in Supabase, stored locally:', err);
  }
}

export async function fetchUserIntegration(
  userId: string,
  userEmail?: string
): Promise<UserTrelloIntegration | null> {
  const apiKey = getTrelloApiKey();

  // Check Supabase first
  try {
    const { data, error } = await supabase
      .from('user_trello_integrations')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!error && data) {
      let trelloEmail = data.trello_email || undefined;
      if (userId === 'adm-2' && (trelloEmail?.toLowerCase().includes('ushal28') || !trelloEmail)) {
        trelloEmail = userEmail || 'wmgteja@gmail.com';
      }
      const parsed: UserTrelloIntegration = {
        userId: data.user_id,
        trelloMemberId: data.trello_member_id,
        trelloUsername: data.trello_username,
        trelloFullName: data.trello_full_name,
        trelloEmail,
        trelloAvatarUrl: data.trello_avatar_url || undefined,
        trelloToken: isValidTrelloToken(data.trello_token, apiKey) ? data.trello_token : '',
        updatedAt: data.updated_at,
      };
      // Keep local storage fresh
      try {
        localStorage.setItem(
          `${LOCAL_STORAGE_INTEGRATION_PREFIX}${userId}`,
          JSON.stringify(parsed)
        );
      } catch {
        // ignore
      }
      return parsed;
    }
  } catch {
    // fallback to localStorage
  }

  try {
    const local = localStorage.getItem(`${LOCAL_STORAGE_INTEGRATION_PREFIX}${userId}`);
    if (local) {
      const parsed = JSON.parse(local) as UserTrelloIntegration;
      if (userId === 'adm-2' && (parsed.trelloEmail?.toLowerCase().includes('ushal28') || !parsed.trelloEmail)) {
        parsed.trelloEmail = userEmail || 'wmgteja@gmail.com';
        try {
          localStorage.setItem(`${LOCAL_STORAGE_INTEGRATION_PREFIX}${userId}`, JSON.stringify(parsed));
        } catch {
          // ignore
        }
      }
      if (parsed && !isValidTrelloToken(parsed.trelloToken, apiKey)) {
        parsed.trelloToken = '';
      }
      return parsed;
    }
  } catch {
    // ignore
  }

  // Auto-connect by login email if not found by userId
  if (userEmail) {
    const cleanEmail = userEmail.trim().toLowerCase();
    const byEmail = await fetchIntegrationByEmail(cleanEmail);
    if (byEmail && isValidTrelloToken(byEmail.trelloToken, apiKey)) {
      const linked: UserTrelloIntegration = {
        ...byEmail,
        userId,
        updatedAt: new Date().toISOString(),
      };
      await saveUserIntegration(linked);
      return linked;
    }
  }

  return null;
}

export async function deleteUserIntegration(userId: string): Promise<void> {
  try {
    localStorage.removeItem(`${LOCAL_STORAGE_INTEGRATION_PREFIX}${userId}`);
  } catch {
    // ignore
  }
  try {
    await supabase
      .from('user_trello_integrations')
      .delete()
      .eq('user_id', userId);
  } catch {
    // ignore
  }
}

export async function fetchAllUserIntegrations(): Promise<
  Record<string, UserTrelloIntegration>
> {
  const result: Record<string, UserTrelloIntegration> = {};

  // First read from localStorage
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_STORAGE_INTEGRATION_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const item = JSON.parse(raw) as UserTrelloIntegration;
          if (item?.userId) {
            result[item.userId] = item;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Then merge Supabase (source of truth)
  try {
    const { data, error } = await supabase
      .from('user_trello_integrations')
      .select('*');

    if (!error && Array.isArray(data)) {
      data.forEach((row) => {
        let trelloEmail = row.trello_email || undefined;
        if (row.user_id === 'adm-2' && (trelloEmail?.toLowerCase().includes('ushal28') || !trelloEmail)) {
          trelloEmail = 'wmgteja@gmail.com';
        }
        result[row.user_id] = {
          userId: row.user_id,
          trelloMemberId: row.trello_member_id,
          trelloUsername: row.trello_username,
          trelloFullName: row.trello_full_name,
          trelloEmail,
          trelloAvatarUrl: row.trello_avatar_url || undefined,
          trelloToken: row.trello_token,
          updatedAt: row.updated_at,
        };
      });
    }
  } catch (err) {
    console.warn('Could not fetch all Trello integrations from Supabase:', err);
  }

  return result;
}

export async function fetchIntegrationByEmail(
  email: string
): Promise<UserTrelloIntegration | null> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return null;

  // 1. Supabase check
  try {
    const { data, error } = await supabase
      .from('user_trello_integrations')
      .select('*')
      .ilike('trello_email', cleanEmail)
      .maybeSingle();

    if (!error && data) {
      return {
        userId: data.user_id,
        trelloMemberId: data.trello_member_id,
        trelloUsername: data.trello_username,
        trelloFullName: data.trello_full_name,
        trelloEmail: data.trello_email || undefined,
        trelloAvatarUrl: data.trello_avatar_url || undefined,
        trelloToken: data.trello_token,
        updatedAt: data.updated_at,
      };
    }
  } catch {
    // fallback to localStorage
  }

  // 2. LocalStorage check
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_STORAGE_INTEGRATION_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const item = JSON.parse(raw) as UserTrelloIntegration;
          if (item?.trelloEmail?.toLowerCase() === cleanEmail) {
            return item;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function connectUserWithToken(
  userId: string,
  userName: string,
  email: string,
  token: string,
  apiKey: string
): Promise<UserTrelloIntegration> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('Please enter your Trello authorization token.');
  }
  if (!isValidTrelloToken(cleanToken, apiKey)) {
    throw new Error('Invalid Trello token. Please ensure you copied the entire token (typically 64 characters).');
  }

  // Verify the token with Trello to retrieve THIS user's real account profile
  const profile = await verifyTrelloToken(apiKey, cleanToken);

  let finalEmail = profile.email || cleanEmail;
  if (userId === 'adm-2' && (!finalEmail || finalEmail.toLowerCase().includes('ushal28'))) {
    finalEmail = 'wmgteja@gmail.com';
  }

  const integration: UserTrelloIntegration = {
    userId,
    trelloMemberId: profile.id,
    trelloUsername: profile.username,
    trelloFullName: profile.fullName || userName,
    trelloEmail: finalEmail,
    trelloAvatarUrl: profile.avatarUrl,
    trelloToken: cleanToken,
    updatedAt: new Date().toISOString(),
  };

  await saveUserIntegration(integration);
  return integration;
}

export async function connectUserByEmail(
  userId: string,
  userName: string,
  email: string,
  apiKey: string
): Promise<UserTrelloIntegration> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Please enter a valid Trello account email.');
  }

  // 1. Check if an integration already exists for this email
  const existing = await fetchIntegrationByEmail(cleanEmail);
  if (existing && isValidTrelloToken(existing.trelloToken, apiKey)) {
    const updated: UserTrelloIntegration = {
      ...existing,
      userId,
      trelloEmail: cleanEmail,
      updatedAt: new Date().toISOString(),
    };
    await saveUserIntegration(updated);
    return updated;
  }

  // 2. Do NOT silently attach another user's .env token!
  throw new Error(
    `No linked Trello account found for "${cleanEmail}". Each member must authorize with Trello once using their personal token.`
  );
}

// ============================================================================
// Direct Trello REST API Helpers (Read & Write with Fallback Store)
// ============================================================================

export async function fetchMemberBoards(
  token: string,
  apiKey: string
): Promise<TrelloBoard[]> {
  if (!isValidTrelloToken(token, apiKey)) {
    return [getFallbackStore().board];
  }
  try {
    const res = await fetch(
      `https://api.trello.com/1/members/me/boards?filter=open&fields=name,desc,url,closed&key=${apiKey}&token=${token}`
    );
    if (!res.ok) {
      return [getFallbackStore().board];
    }
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data : [getFallbackStore().board];
  } catch {
    return [getFallbackStore().board];
  }
}

export async function fetchBoardLists(
  boardId: string,
  token: string,
  apiKey: string
): Promise<TrelloList[]> {
  if (!isValidTrelloToken(token, apiKey) || boardId.startsWith('board-wmd')) {
    return getFallbackStore().lists;
  }
  try {
    const res = await fetch(
      `https://api.trello.com/1/boards/${boardId}/lists?filter=open&fields=name,closed,idBoard&key=${apiKey}&token=${token}`
    );
    if (!res.ok) return getFallbackStore().lists;
    return await res.json();
  } catch {
    return getFallbackStore().lists;
  }
}

export async function fetchBoardCards(
  boardId: string,
  token: string,
  apiKey: string
): Promise<TrelloCard[]> {
  if (!isValidTrelloToken(token, apiKey) || boardId.startsWith('board-wmd')) {
    return getFallbackStore().cards;
  }
  try {
    const res = await fetch(
      `https://api.trello.com/1/boards/${boardId}/cards?filter=open&fields=name,desc,due,dueComplete,idList,idBoard,labels,shortUrl,dateLastActivity,idMembers&key=${apiKey}&token=${token}`
    );
    if (!res.ok) return getFallbackStore().cards;
    return await res.json();
  } catch {
    return getFallbackStore().cards;
  }
}

export async function fetchCardActions(
  cardId: string,
  token: string,
  apiKey: string
): Promise<TrelloCardAction[]> {
  if (!isValidTrelloToken(token, apiKey) || cardId.startsWith('card-sample')) {
    return getFallbackStore().actions.filter((a) => a.data?.card?.id === cardId);
  }
  try {
    const res = await fetch(
      `https://api.trello.com/1/cards/${cardId}/actions?filter=commentCard,updateCard:idList&limit=25&key=${apiKey}&token=${token}`
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function fetchMemberRecentActions(
  memberId: string,
  token: string,
  apiKey: string,
  limit = 50
): Promise<TrelloCardAction[]> {
  if (!isValidTrelloToken(token, apiKey)) {
    return getFallbackStore().actions.slice(0, limit);
  }
  try {
    const res = await fetch(
      `https://api.trello.com/1/members/${memberId}/actions?filter=commentCard,updateCard:idList,createCard&limit=${limit}&key=${apiKey}&token=${token}`
    );
    if (!res.ok) return getFallbackStore().actions.slice(0, limit);
    return await res.json();
  } catch {
    return getFallbackStore().actions.slice(0, limit);
  }
}

export async function addCardComment(
  cardId: string,
  commentText: string,
  token: string,
  apiKey: string
): Promise<TrelloCardAction> {
  if (!isValidTrelloToken(token, apiKey) || cardId.startsWith('card-sample')) {
    const store = getFallbackStore();
    const action: TrelloCardAction = {
      id: `act-${Date.now()}`,
      idMemberCreator: 'me',
      type: 'commentCard',
      date: new Date().toISOString(),
      data: {
        text: commentText,
        card: { id: cardId, name: store.cards.find((c) => c.id === cardId)?.name || 'Task' },
      },
    };
    store.actions = [action, ...store.actions];
    saveFallbackStore(store);
    return action;
  }
  const url = `https://api.trello.com/1/cards/${cardId}/actions/comments?key=${apiKey}&token=${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: commentText }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to post comment to Trello.');
  }
  return await res.json();
}

export async function moveCardToList(
  cardId: string,
  targetListId: string,
  token: string,
  apiKey: string
): Promise<TrelloCard> {
  if (!isValidTrelloToken(token, apiKey) || cardId.startsWith('card-sample')) {
    const store = getFallbackStore();
    const card = store.cards.find((c) => c.id === cardId);
    if (card) {
      card.idList = targetListId;
      card.dateLastActivity = new Date().toISOString();
      saveFallbackStore(store);
      return card;
    }
  }
  const url = `https://api.trello.com/1/cards/${cardId}?idList=${targetListId}&key=${apiKey}&token=${token}`;
  const res = await fetch(url, { method: 'PUT' });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to move card in Trello.');
  }
  return await res.json();
}

export async function toggleCardCompletion(
  cardId: string,
  dueComplete: boolean,
  token: string,
  apiKey: string
): Promise<TrelloCard> {
  if (!isValidTrelloToken(token, apiKey) || cardId.startsWith('card-sample')) {
    const store = getFallbackStore();
    const card = store.cards.find((c) => c.id === cardId);
    if (card) {
      card.dueComplete = dueComplete;
      card.dateLastActivity = new Date().toISOString();
      saveFallbackStore(store);
      return card;
    }
  }
  const url = `https://api.trello.com/1/cards/${cardId}?dueComplete=${dueComplete}&key=${apiKey}&token=${token}`;
  const res = await fetch(url, { method: 'PUT' });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to update card completion status.');
  }
  return await res.json();
}

export async function createNewCard(
  listId: string,
  name: string,
  desc: string,
  token: string,
  apiKey: string
): Promise<TrelloCard> {
  if (!isValidTrelloToken(token, apiKey) || listId.startsWith('list-')) {
    const store = getFallbackStore();
    const newCard: TrelloCard = {
      id: `card-sample-${Date.now()}`,
      name,
      desc,
      idList: listId,
      idBoard: store.board.id,
      dueComplete: false,
      dateLastActivity: new Date().toISOString(),
    };
    store.cards = [...store.cards, newCard];
    saveFallbackStore(store);
    return newCard;
  }
  const url = `https://api.trello.com/1/cards?idList=${listId}&key=${apiKey}&token=${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, desc }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to create new card in Trello.');
  }
  return await res.json();
}
