import React, { useState, useEffect } from 'react';
import {
  getNotificationPermissionStatus,
  isSecureContextEnvironment,
  requestWebNotificationPermission,
  showWebNotification,
} from '../../lib/notifications';
import './NotificationModal.css';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [webPermission, setWebPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const isSecure = isSecureContextEnvironment();

  useEffect(() => {
    if (isOpen) {
      setWebPermission(getNotificationPermissionStatus());
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEnableWebPush = async () => {
    setFeedback(null);

    if (!isSecure) {
      setFeedback({
        type: 'error',
        message: 'Browser notifications require a secure HTTPS connection (or localhost). HTTP on LAN IPs blocks notifications.',
      });
      return;
    }

    if (webPermission === 'denied') {
      setFeedback({
        type: 'warning',
        message: 'Notifications are currently blocked. Click the lock/settings icon in your browser address bar and switch Notifications to "Allow", then reload the page.',
      });
      return;
    }

    const granted = await requestWebNotificationPermission();
    const updatedStatus = getNotificationPermissionStatus();
    setWebPermission(updatedStatus);

    if (granted) {
      setFeedback({
        type: 'success',
        message: 'Browser notifications activated successfully on this device!',
      });
    } else if (updatedStatus === 'denied') {
      setFeedback({
        type: 'warning',
        message: 'Permission was blocked in your browser settings. Please click the site settings / lock icon in the address bar and set Notifications to "Allow".',
      });
    } else {
      setFeedback({
        type: 'warning',
        message: 'Permission was dismissed or not granted.',
      });
    }
  };

  const handleTestWebPush = async () => {
    try {
      await showWebNotification(
        '🔔 Portal Alert Test',
        'If you see and hear this chime, your device is ready to receive instant complaint alerts!'
      );
      setFeedback({
        type: 'success',
        message: 'Test alert sent! Check your system notification tray/banners and sound.',
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
              <p className="notif-subtitle">Receive instant desktop & mobile alerts</p>
            </div>
          </div>
          <button type="button" className="notif-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="notif-modal-body">
          {!isSecure && (
            <div className="notif-feedback notif-feedback--error">
              ⚠️ <strong>Insecure Connection:</strong> Web notifications require HTTPS. If accessing over HTTP (e.g. via local Wi-Fi IP), modern browsers will disable notifications.
            </div>
          )}

          <section className="notif-section">
            <div className="notif-section-header">
              <h4>Device Push & Chime Alerts</h4>
              <span
                className={`notif-status-badge notif-status-badge--${
                  webPermission === 'granted' ? 'active' : 'inactive'
                }`}
              >
                {webPermission === 'granted'
                  ? '● Active'
                  : webPermission === 'denied'
                  ? '✕ Blocked'
                  : '○ Not Enabled'}
              </span>
            </div>
            <p className="notif-desc">
              When enabled, your device will pop up system notification banners and play a chime
              whenever a new complaint is assigned, a remark is added, or a complaint is finalized.
            </p>

            <div className="notif-btn-row">
              {webPermission !== 'granted' ? (
                <button
                  type="button"
                  className="notif-btn notif-btn--primary"
                  onClick={handleEnableWebPush}
                >
                  Enable Notifications on this Device
                </button>
              ) : (
                <button
                  type="button"
                  className="notif-btn notif-btn--secondary"
                  onClick={handleTestWebPush}
                >
                  🔔 Test Alert Sound & Banner
                </button>
              )}
            </div>
          </section>

          <div className="notif-info-box">
            <strong>💡 How Realtime Alerts Work:</strong>
            <p>
              Keep this portal tab open or minimized on your PC or phone. Whenever another team
              member submits a complaint or updates remarks, your screen will alert you in
              real-time.
            </p>
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
