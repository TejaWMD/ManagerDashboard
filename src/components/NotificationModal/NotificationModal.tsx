import React, { useState, useEffect } from 'react';
import { UserAccount } from '../../types';
import {
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

  const handleEnablePush = async () => {
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
          'Notifications are currently blocked by your browser. Click the lock/tune icon in your browser address bar and switch Notifications to "Allow", then reload the page.',
      });
      return;
    }

    setLoading(true);
    const result = await subscribeUserToPush(currentUser.id, true);
    setLoading(false);

    await refreshStatus();

    if (result.success) {
      setFeedback({
        type: 'success',
        message: 'Notifications enabled successfully!',
      });
      showWebNotification(
        '🔔 Notifications Activated',
        'Your device is now registered to receive alerts.'
      );
    } else {
      setFeedback({
        type: 'error',
        message:
          result.error ||
          'Failed to enable notifications. Please verify your connection.',
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
        message: 'Notifications disabled. You will not receive alerts.',
      });
    } else {
      setFeedback({
        type: 'error',
        message: result.error || 'Failed to disable notifications.',
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

  return (
    <div className="notif-modal-overlay" onClick={onClose}>
      <div className="notif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notif-modal-header">
          <div className="notif-header-title">
            <span className="notif-icon">🔔</span>
            <div>
              <h3>Browser Notification Settings</h3>
              <p className="notif-subtitle">
                Manage desktop alerts &amp; Supabase push notifications
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
                  isRegisteredInDb
                    ? 'active'
                    : webPermission === 'denied'
                    ? 'blocked'
                    : 'inactive'
                }`}
              >
                {checking
                  ? 'Checking...'
                  : isRegisteredInDb
                  ? '● Enabled'
                  : webPermission === 'denied'
                  ? '✕ Blocked in Browser'
                  : '○ Disabled'}
              </span>
            </div>

            <p className="notif-desc">
              When enabled, your device will receive desktop alerts whenever an urgent query is raised, a query is assigned, a solution remark is submitted, or a 24-hour urgent reminder is triggered.
            </p>

            <div className="notif-btn-row">
              {isRegisteredInDb ? (
                <>
                  <button
                    type="button"
                    className="notif-btn notif-btn--danger"
                    onClick={handleDisablePush}
                    disabled={loading || checking}
                    title="Stop receiving desktop notifications on this device"
                  >
                    {loading ? 'Disabling...' : '❌ Disable Notifications'}
                  </button>
                  <button
                    type="button"
                    className="notif-btn notif-btn--secondary"
                    onClick={handleTestWebPush}
                    disabled={loading || checking}
                  >
                    🔔 Test Alert Sound
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="notif-btn notif-btn--primary"
                  onClick={handleEnablePush}
                  disabled={loading || checking}
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
