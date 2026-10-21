import React, { useState, useEffect } from 'react';
import {
  getNotificationPermissionStatus,
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
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setWebPermission(getNotificationPermissionStatus());
      setTestFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEnableWebPush = async () => {
    setTestFeedback(null);
    const granted = await requestWebNotificationPermission();
    setWebPermission(getNotificationPermissionStatus());
    if (granted) {
      setTestFeedback('Browser notifications activated successfully on this device!');
    } else {
      setTestFeedback('Permission was blocked or denied in your browser settings.');
    }
  };

  const handleTestWebPush = () => {
    showWebNotification(
      '🔔 Portal Alert Test',
      'If you see and hear this chime, your device is ready to receive instant complaint alerts!'
    );
    setTestFeedback('Test notification triggered!');
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
          <section className="notif-section">
            <div className="notif-section-header">
              <h4>Device Push & Chime Alerts</h4>
              <span
                className={`notif-status-badge notif-status-badge--${
                  webPermission === 'granted' ? 'active' : 'inactive'
                }`}
              >
                {webPermission === 'granted' ? '● Active' : '○ Not Enabled'}
              </span>
            </div>
            <p className="notif-desc">
              When enabled, your device will pop up system notification banners and play a sound
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

          {testFeedback && (
            <div className="notif-feedback notif-feedback--success">{testFeedback}</div>
          )}
        </div>
      </div>
    </div>
  );
};
