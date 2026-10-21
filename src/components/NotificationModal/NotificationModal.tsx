import React, { useState, useEffect } from 'react';
import { UserAccount } from '../../types';
import {
  cleanPhoneNumber,
  getLocalCallMeBotKeys,
  getNotificationPermissionStatus,
  requestWebNotificationPermission,
  saveLocalCallMeBotKey,
  sendCallMeBotWhatsApp,
  showWebNotification,
} from '../../lib/notifications';
import { updateUserSettingsInDb } from '../../lib/supabase';
import './NotificationModal.css';

interface NotificationModalProps {
  currentUser: UserAccount;
  allUsers: UserAccount[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateUser: (updatedUser: UserAccount) => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  currentUser,
  allUsers,
  isOpen,
  onClose,
  onUpdateUser,
}) => {
  const [webPermission, setWebPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [apiKey, setApiKey] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Admin view for all users
  const [adminSelectedUserId, setAdminSelectedUserId] = useState<string>(currentUser.id);

  useEffect(() => {
    if (isOpen) {
      setWebPermission(getNotificationPermissionStatus());
      const localKeys = getLocalCallMeBotKeys();
      const currentTargetUser = allUsers.find((u) => u.id === adminSelectedUserId) || currentUser;
      setPhone(currentTargetUser.phone || '');
      setApiKey(localKeys[currentTargetUser.id] || currentTargetUser.callmebotApiKey || '');
      setTestStatus(null);
      setTestError(null);
    }
  }, [isOpen, adminSelectedUserId, allUsers, currentUser]);

  if (!isOpen) return null;

  const targetUser = allUsers.find((u) => u.id === adminSelectedUserId) || currentUser;

  const handleEnableWebPush = async () => {
    const granted = await requestWebNotificationPermission();
    setWebPermission(getNotificationPermissionStatus());
    if (granted) {
      setTestStatus('Browser notifications activated successfully on this device!');
    } else {
      setTestError('Permission was denied or blocked in your browser settings.');
    }
  };

  const handleTestWebPush = () => {
    showWebNotification(
      '🔔 Test Notification',
      'If you see this, your device is ready to receive instant alerts!'
    );
    setTestStatus('Test notification triggered!');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setTestStatus(null);
    setTestError(null);

    const trimmedKey = apiKey.trim();
    const trimmedPhone = phone.trim();

    saveLocalCallMeBotKey(targetUser.id, trimmedKey);

    await updateUserSettingsInDb(targetUser.id, {
      phone: trimmedPhone,
      callmebotApiKey: trimmedKey,
    });

    const updated: UserAccount = {
      ...targetUser,
      phone: trimmedPhone,
      callmebotApiKey: trimmedKey,
    };
    onUpdateUser(updated);

    setIsSaving(false);
    setTestStatus(`Saved settings for ${targetUser.name}!`);
  };

  const handleSendTestWhatsApp = async () => {
    setTestStatus(null);
    setTestError(null);

    const clean = cleanPhoneNumber(phone);
    if (!clean) {
      setTestError('Please enter a valid phone number with country code (e.g. +601157350949)');
      return;
    }
    if (!apiKey.trim()) {
      setTestError('Please enter your CallMeBot API key first.');
      return;
    }

    setTestStatus('Dispatching test WhatsApp message to ' + phone + '...');

    const message = [
      `🔔 *WM Portal Test Alert*`,
      `Hello ${targetUser.name}!`,
      `Your WhatsApp notification setup is working successfully.`,
      `You will receive alerts here whenever complaints are created, updated, or finalized.`,
    ].join('\n');

    const res = await sendCallMeBotWhatsApp(phone, apiKey.trim(), message);
    if (res.success) {
      setTestStatus(`✅ WhatsApp message sent! Please check WhatsApp on ${phone}.`);
    } else {
      setTestError(res.error || 'Failed to dispatch WhatsApp message.');
    }
  };

  return (
    <div className="notif-modal-overlay" onClick={onClose}>
      <div className="notif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notif-modal-header">
          <div className="notif-header-title">
            <span className="notif-icon">🔔</span>
            <div>
              <h3>Notification Settings</h3>
              <p className="notif-subtitle">Configure WhatsApp & Web Alerts for real-time updates</p>
            </div>
          </div>
          <button type="button" className="notif-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="notif-modal-body">
          {/* Section 1: Web Push / Browser System Notifications */}
          <section className="notif-section">
            <div className="notif-section-header">
              <h4>1. Browser & Device Push Alerts</h4>
              <span
                className={`notif-status-badge notif-status-badge--${
                  webPermission === 'granted' ? 'active' : 'inactive'
                }`}
              >
                {webPermission === 'granted' ? '● Active' : '○ Not Enabled'}
              </span>
            </div>
            <p className="notif-desc">
              Pops up native notifications on your laptop or phone lock screen when actions occur.
            </p>

            <div className="notif-btn-row">
              {webPermission !== 'granted' ? (
                <button
                  type="button"
                  className="notif-btn notif-btn--primary"
                  onClick={handleEnableWebPush}
                >
                  Enable Browser Notifications on this Device
                </button>
              ) : (
                <button
                  type="button"
                  className="notif-btn notif-btn--secondary"
                  onClick={handleTestWebPush}
                >
                  🔔 Test Browser Alert Sound & Banner
                </button>
              )}
            </div>
          </section>

          {/* Section 2: WhatsApp Alerts (CallMeBot) */}
          <section className="notif-section">
            <div className="notif-section-header">
              <h4>2. WhatsApp Notifications (CallMeBot)</h4>
              <span className="notif-status-badge notif-status-badge--active">Free Gateway</span>
            </div>
            <p className="notif-desc">
              Sends instant WhatsApp messages to managers and account managers when actions are taken.
            </p>

            {currentUser.role === 'admin' && allUsers.length > 1 && (
              <div className="notif-user-select-row">
                <label htmlFor="user-select">Configuring for user:</label>
                <select
                  id="user-select"
                  className="notif-select"
                  value={adminSelectedUserId}
                  onChange={(e) => setAdminSelectedUserId(e.target.value)}
                >
                  {allUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.roleLabel}) — {u.phone || 'No phone'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Step-by-step setup guide */}
            <div className="notif-instructions-box">
              <strong>How to get your free CallMeBot API key:</strong>
              <ol>
                <li>
                  Add this number to your WhatsApp contacts: <code>+34 623 78 64 49</code> (or tap{' '}
                  <a
                    href="https://wa.me/34623786449?text=I%20allow%20callmebot%20to%20send%20me%20messages"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in WhatsApp
                  </a>
                  )
                </li>
                <li>
                  Send this exact message: <code>I allow callmebot to send me messages</code>
                </li>
                <li>The bot will reply in seconds with your personal API Key. Paste it below!</li>
              </ol>
            </div>

            <form onSubmit={handleSaveSettings} className="notif-form">
              <div className="notif-field">
                <label htmlFor="phone-input">Phone Number (with country code):</label>
                <input
                  id="phone-input"
                  type="text"
                  className="notif-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+60123456789"
                  required
                />
              </div>

              <div className="notif-field">
                <label htmlFor="key-input">CallMeBot API Key:</label>
                <input
                  id="key-input"
                  type="text"
                  className="notif-input"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="e.g. 123456"
                />
              </div>

              <div className="notif-btn-row">
                <button
                  type="submit"
                  className="notif-btn notif-btn--primary"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Settings'}
                </button>

                <button
                  type="button"
                  className="notif-btn notif-btn--secondary"
                  onClick={handleSendTestWhatsApp}
                  disabled={!apiKey.trim() || !phone.trim()}
                >
                  📲 Send Test WhatsApp Alert
                </button>
              </div>
            </form>
          </section>

          {/* Feedback messages */}
          {testStatus && <div className="notif-feedback notif-feedback--success">{testStatus}</div>}
          {testError && <div className="notif-feedback notif-feedback--error">{testError}</div>}
        </div>
      </div>
    </div>
  );
};
