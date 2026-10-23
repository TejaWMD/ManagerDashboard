import React, { useState, useEffect } from 'react';
import { UserAccount } from '../../types';
import {
  getNotificationPermissionStatus,
  isSecureContextEnvironment,
  showWebNotification,
} from '../../lib/notifications';
import {
  subscribeUserToPush,
  getExistingPushSubscription,
  unsubscribeUserFromPush,
} from '../../lib/pushSubscription';
import { dispatchComplaintPushNotification } from '../../lib/pushDispatcher';
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
  const [hasPushSub, setHasPushSub] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const isSecure = isSecureContextEnvironment();

  useEffect(() => {
    if (isOpen) {
      setWebPermission(getNotificationPermissionStatus());
      getExistingPushSubscription().then((sub) => {
        setHasPushSub(Boolean(sub));
      });
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEnableWebPush = async () => {
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
          'Notifications are currently blocked. Click the lock/settings icon in your browser address bar and switch Notifications to "Allow", then reload the page.',
      });
      return;
    }

    setLoading(true);
    const result = await subscribeUserToPush(currentUser.id);
    setLoading(false);

    const updatedStatus = getNotificationPermissionStatus();
    setWebPermission(updatedStatus);

    if (result.success) {
      setHasPushSub(true);
      setFeedback({
        type: 'success',
        message: 'Desktop background push notifications activated successfully!',
      });
      showWebNotification(
        '🔔 Notifications Enabled',
        'You will now receive desktop alerts even when the browser tab is closed.'
      );
    } else {
      setFeedback({
        type: updatedStatus === 'denied' ? 'warning' : 'error',
        message:
          result.error ||
          'Failed to enable notifications. Please verify browser permissions.',
      });
    }
  };

  const handleDisablePush = async () => {
    setLoading(true);
    await unsubscribeUserFromPush(currentUser.id);
    setHasPushSub(false);
    setLoading(false);
    setFeedback({
      type: 'warning',
      message: 'Background push notifications disabled on this device.',
    });
  };

  const handleTestWebPush = async () => {
    try {
      await showWebNotification(
        '🔔 Portal Alert Test',
        'If you see and hear this chime, your device is ready to receive instant complaint alerts!'
      );

      // Also trigger test push dispatch
      await dispatchComplaintPushNotification({
        event: 'TEST',
        complaint: {
          id: 'TEST-001',
          complaintId: 'CMP-TEST',
          createdAt: '',
          createdAtMs: Date.now(),
          accountManagerId: currentUser.id,
          accountManagerName: currentUser.name,
          accountManagerEmail: currentUser.email,
          managerId: currentUser.id,
          managerName: currentUser.name,
          managerEmail: currentUser.email,
          complaintTitle: 'Test Notification',
          complaintText: 'Test desktop push notification alert',
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
          'Test alert sent! Check your system notification tray and chime sound.',
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
              {/* <p className="notif-subtitle">
                Receive instant desktop alerts even when tabs are closed
              </p> */}
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
              If accessing over plain HTTP, modern browsers will disable notifications.
            </div>
          )}

          <section className="notif-section">
            <div className="notif-section-header">
              <h4>Desktop Push & Chime Alerts</h4>
              <span
                className={`notif-status-badge notif-status-badge--${
                  webPermission === 'granted' && hasPushSub ? 'active' : 'inactive'
                }`}
              >
                {webPermission === 'granted' && hasPushSub
                  ? '● Active'
                  : webPermission === 'denied'
                  ? '✕ Blocked'
                  : '○ Not Subscribed'}
              </span>
            </div>
            <p className="notif-desc">
              When enabled, your device will receive notifications whenever a complaint is assigned, a remark is submitted, a box is checked
            </p>

            <div className="notif-btn-row">
              {(!hasPushSub || webPermission !== 'granted') ? (
                <button
                  type="button"
                  className="notif-btn notif-btn--primary"
                  onClick={handleEnableWebPush}
                  disabled={loading}
                >
                  {loading ? 'Subscribing...' : 'Enable Desktop Notifications'}
                </button>
              ) : (
                <>
                  {/* <button
                    type="button"
                    className="notif-btn notif-btn--secondary"
                    onClick={handleTestWebPush}
                  >
                    🔔 Test Alert Sound & Banner
                  </button>
                  <button
                    type="button"
                    className="notif-btn notif-btn--ghost"
                    onClick={handleDisablePush}
                    disabled={loading}
                  >
                    Disable on this device
                  </button> */}
                </>
              )}
            </div>
          </section>

          <div className="notif-info-box">
            <strong>💡 Notification Rules for {currentUser.name} ({currentUser.roleLabel}):</strong>
            <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0, fontSize: '0.8rem', lineHeight: '1.45' }}>
              {currentUser.role === 'account_manager' && (
                <>
                  <li>Notified when the manager submits a remark</li>
                  <li>Notified when the manager checks the Done button</li>
                  <li>Notified when a complaint is delayed without manager action</li>
                </>
              )}
              {currentUser.role === 'manager' && (
                <>
                  <li>Notified when a sender submits a complaint for you</li>
                  <li>Notified when the sender submits a remark</li>
                  <li>Notified when the sender checks Done</li>
                  <li>Notified when a complaint is delayed without manager action</li>
                </>
              )}
              {currentUser.role === 'admin' && (
                <>
                  <li>Notified for <strong>all events</strong> across all managers and account managers</li>
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
