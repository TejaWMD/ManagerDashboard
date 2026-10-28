import React, { useState, useEffect } from 'react';
import { UserAccount } from '../../types';
import {
  getNotificationPermissionStatus,
  isSecureContextEnvironment,
  showWebNotification,
} from '../../lib/notifications';
import {
  checkPushStatus,
  subscribeUserToPush,
  unsubscribeUserFromPush,
} from '../../lib/pushSubscription';
import { dispatchQueryPushNotification } from '../../lib/pushDispatcher';
import './NotificationModal.css';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserAccount;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [webPermission, setWebPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [hasBrowserSub, setHasBrowserSub] = useState<boolean>(false);
  const [isRegisteredInDb, setIsRegisteredInDb] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const isSecure = isSecureContextEnvironment();

  const refreshStatus = async () => {
    setChecking(true);
    try {
      const status = await checkPushStatus(currentUser.id);
      setWebPermission(status.permission);
      setHasBrowserSub(status.hasBrowserSub);
      setIsRegisteredInDb(status.isRegisteredInDb);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
      refreshStatus();
    }
  }, [isOpen, currentUser.id]);

  if (!isOpen) return null;

  const handleEnableOrResync = async (forceRenew = false) => {
    setFeedback(null);

    if (!isSecure) {
      setFeedback({
        type: 'error',
        message:
          'Browser notifications require a secure HTTPS connection (or localhost). HTTP on LAN IPs blocks notifications.',
      });
      return;
    }

    if (webPermission === 'denied') {
      setFeedback({
        type: 'warning',
        message:
          'Notifications are currently blocked. Click the lock/tune icon in your browser address bar and switch Notifications to "Allow", then reload the page.',
      });
      return;
    }

    setLoading(true);
    // forceRenew = true unsubscribes any stale browser subscription and creates a fresh token in Supabase
    const result = await subscribeUserToPush(currentUser.id, forceRenew);
    setLoading(false);

    await refreshStatus();

    if (result.success) {
      setFeedback({
        type: 'success',
        message: 'Push subscription successfully saved to Supabase and active on this device!',
      });
      showWebNotification(
        '🔔 Notifications Activated',
        'Your device is now registered in Supabase to receive instant alerts.'
      );
    } else {
      setFeedback({
        type: 'error',
        message:
          result.error ||
          'Failed to register notifications in Supabase. Please verify your connection.',
      });
    }
  };

  const handleDisablePush = async () => {
    setLoading(true);
    setFeedback(null);
    const result = await unsubscribeUserFromPush(currentUser.id);
    setLoading(false);
    await refreshStatus();

    if (result.success) {
      setFeedback({
        type: 'warning',
        message: 'Notifications disabled and removed from Supabase for this device.',
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error || 'Failed to unsubscribe.',
      });
    }
  };

  const handleTestWebPush = async () => {
    try {
      await showWebNotification(
        '🔔 Portal Alert Test',
        'If you see this and hear the chime, your device is ready to receive instant query alerts!'
      );

      // Trigger test push dispatch through Supabase Edge Function
      await dispatchQueryPushNotification({
        event: 'TEST',
        query: {
          id: 'TEST-001',
          queryId: 'QRY-TEST',
          createdAt: '',
          createdAtMs: Date.now(),
          accountManagerId: currentUser.id,
          accountManagerName: currentUser.name,
          accountManagerEmail: currentUser.email,
          managerId: currentUser.id,
          managerName: currentUser.name,
          managerEmail: currentUser.email,
          queryTitle: 'Test Notification',
          queryText: 'Test notification alert',
          managerRemarkTitle: '',
          managerRemark: '',
          managerDone: false,
          accountManagerRemarkTitle: '',
          accountManagerRemark: '',
          accountManagerDone: false,
          status: 'Pending',
        },
        actor: currentUser,
      });

      setFeedback({
        type: 'success',
        message:
          'Test notification dispatched! Check your desktop notification tray and alert chime.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: `Failed to trigger alert: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const isFullyActive = webPermission === 'granted' && isRegisteredInDb;
  const isMissingInDb = webPermission === 'granted' && !isRegisteredInDb;

  return (
    <div className="notif-modal-overlay" onClick={onClose}>
      <div className="notif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notif-modal-header">
          <div className="notif-header-title">
            <span className="notif-icon">🔔</span>
            <div>
              <h3>Browser Notification Settings</h3>
              <p className="notif-subtitle">
                Manage desktop alerts &amp; Supabase push synchronization
              </p>
            </div>
          </div>
          <button
            type="button"
            className="notif-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="notif-modal-body">
          {!isSecure && (
            <div className="notif-feedback notif-feedback--error">
              ⚠️ <strong>Insecure Connection:</strong> Web notifications require HTTPS.
              If accessing over plain HTTP, modern browsers disable push notifications.
            </div>
          )}

          <section className="notif-section">
            <div className="notif-section-header">
              <h4>Push Notification Status</h4>
              <span
                className={`notif-status-badge notif-status-badge--${
                  isFullyActive
                    ? 'active'
                    : isMissingInDb
                    ? 'warning'
                    : webPermission === 'denied'
                    ? 'blocked'
                    : 'inactive'
                }`}
              >
                {checking
                  ? 'Checking...'
                  : isFullyActive
                  ? '● Active & Synced'
                  : isMissingInDb
                  ? '⚠️ Missing in Supabase'
                  : webPermission === 'denied'
                  ? '✕ Blocked in Browser'
                  : '○ Disabled'}
              </span>
            </div>

            {isMissingInDb && (
              <div className="notif-re-sync-box">
                <strong>⚠️ Subscription Missing in Database:</strong>
                <span>
                  Your browser has notification permissions enabled, but your subscription was deleted or not found in Supabase.
                  Click <strong>&ldquo;Re-Enable &amp; Save to Supabase&rdquo;</strong> below to restore your device subscription so you can receive alerts again.
                </span>
              </div>
            )}

            <p className="notif-desc">
              When enabled, your device will receive desktop alerts whenever an urgent query is raised, a query is assigned, a solution remark is submitted, or a 24-hour urgent reminder is triggered.
            </p>

            <div className="notif-btn-row">
              {isMissingInDb ? (
                <>
                  <button
                    type="button"
                    className="notif-btn notif-btn--primary"
                    onClick={() => handleEnableOrResync(true)}
                    disabled={loading}
                  >
                    {loading ? 'Saving to Supabase...' : '🔔 Re-Enable & Save to Supabase'}
                  </button>
                  <button
                    type="button"
                    className="notif-btn notif-btn--danger"
                    onClick={handleDisablePush}
                    disabled={loading}
                  >
                    Disable on this device
                  </button>
                </>
              ) : isFullyActive ? (
                <>
                  <button
                    type="button"
                    className="notif-btn notif-btn--danger"
                    onClick={handleDisablePush}
                    disabled={loading}
                    title="Stop receiving desktop notifications on this browser"
                  >
                    {loading ? 'Disabling...' : '❌ Disable Notifications'}
                  </button>
                  <button
                    type="button"
                    className="notif-btn notif-btn--secondary"
                    onClick={() => handleEnableOrResync(true)}
                    disabled={loading}
                    title="Re-registers your subscription endpoint with Supabase"
                  >
                    {loading ? 'Syncing...' : '🔄 Re-Sync to Supabase'}
                  </button>
                  <button
                    type="button"
                    className="notif-btn notif-btn--secondary"
                    onClick={handleTestWebPush}
                    disabled={loading}
                  >
                    🔔 Test Alert Sound
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="notif-btn notif-btn--primary"
                  onClick={() => handleEnableOrResync(false)}
                  disabled={loading}
                >
                  {loading ? 'Activating...' : '🔔 Enable Notifications'}
                </button>
              )}
            </div>
          </section>

          <div className="notif-info-box">
            <strong>💡 Notification Matrix for {currentUser.name} ({currentUser.roleLabel}):</strong>
            <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0, fontSize: '0.8rem', lineHeight: '1.45' }}>
              {currentUser.role === 'account_manager' && (
                <>
                  <li>Notified when the manager submits a solution remark</li>
                  <li>Notified when the manager marks a query Done</li>
                  <li>Notified on 24-hour urgent query reminders and SLA delay breaches</li>
                </>
              )}
              {currentUser.role === 'manager' && (
                <>
                  <li>Notified immediately when a new query or <strong>🚨 URGENT Query</strong> is assigned to you</li>
                  <li>Notified every 24 hours for open urgent queries until completed</li>
                  <li>Notified when the sender adds remarks or verifies completion</li>
                  <li>Notified on SLA delay breaches without manager action</li>
                </>
              )}
              {currentUser.role === 'admin' && (
                <>
                  <li>Notified for <strong>all portal events</strong>, urgent queries, 24h reminders, and SLA alerts</li>
                </>
              )}
            </ul>
          </div>

          {feedback && (
            <div className={`notif-feedback notif-feedback--${feedback.type}`}>
              {feedback.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
