import React, { useEffect, useState } from 'react';
import { UserAccount } from '../../types';
import {
  isPushNotificationSupported,
  subscribeUserToPush,
  checkPushStatus,
} from '../../lib/pushSubscription';
import { showWebNotification } from '../../lib/notifications';
import './NotificationBanner.css';

interface NotificationBannerProps {
  currentUser: UserAccount;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  currentUser,
}) => {
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [hasSubscription, setHasSubscription] = useState<boolean>(false);
  const [isMissingInDb, setIsMissingInDb] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('wm_notif_banner_dismissed') === 'true';
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    const supported = isPushNotificationSupported();
    setIsSupported(supported);

    if (supported && typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
      checkPushStatus(currentUser.id).then((status) => {
        setHasSubscription(status.hasBrowserSub && status.isRegisteredInDb);
        setIsMissingInDb(status.hasBrowserSub && !status.isRegisteredInDb);
      });
    } else {
      setPermission('unsupported');
    }
  }, [currentUser.id]);

  if (!isSupported || dismissed) {
    return null;
  }

  // If already subscribed and properly synced in DB, don't show prompt
  if (hasSubscription && !isMissingInDb) {
    return null;
  }

  // If permission is granted and NOT missing in DB, don't show prompt
  if (permission === 'granted' && !isMissingInDb) {
    return null;
  }

  const handleEnable = async () => {
    setLoading(true);
    setFeedback(null);

    // If missing in DB, forceRenew to regenerate fresh token and save in Supabase
    const result = await subscribeUserToPush(currentUser.id, isMissingInDb);
    setLoading(false);

    if (result.success) {
      setHasSubscription(true);
      setIsMissingInDb(false);
      setPermission('granted');
      setFeedback({
        type: 'success',
        message: 'Notifications registered and synced successfully!',
      });
      showWebNotification(
        '🔔 Notifications Activated',
        `Welcome ${currentUser.name}! Your device is registered to receive instant alerts.`
      );
      setTimeout(() => setDismissed(true), 3500);
    } else {
      const currentPerm =
        typeof window !== 'undefined' && 'Notification' in window
          ? Notification.permission
          : 'default';
      setPermission(currentPerm);
      setFeedback({
        type: currentPerm === 'denied' ? 'warning' : 'error',
        message:
          currentPerm === 'denied'
            ? 'Notifications were blocked by your browser. Click the site settings/lock icon in your browser address bar and set Notifications to "Allow", then reload.'
            : result.error || 'Failed to enable notifications.',
      });
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('wm_notif_banner_dismissed', 'true');
    } catch {
      // Ignore
    }
  };

  return (
    <div className="notif-banner" role="region" aria-label="Notification Prompt">
      <div className="notif-banner-content">
        <div className="notif-banner-icon-box">{isMissingInDb ? '⚠️' : '🔔'}</div>
        <div className="notif-banner-text-box">
          <div className="notif-banner-title">
            {isMissingInDb ? 'Push Notifications Disconnected' : 'Enable Notifications Alerts'}
          </div>
          <div className="notif-banner-desc">
            {isMissingInDb
              ? 'Your device subscription was removed from Supabase. Re-sync now so you can continue receiving desktop alerts.'
              : 'Stay alerted on new queries, urgent tasks, manager remarks, and delay alerts even when your browser tab is closed.'}
          </div>
          {feedback && (
            <div className={`notif-banner-feedback notif-banner-feedback--${feedback.type}`}>
              {feedback.message}
            </div>
          )}
        </div>
      </div>
      <div className="notif-banner-actions">
        <button
          type="button"
          className="notif-btn notif-btn--primary"
          onClick={handleEnable}
          disabled={loading}
        >
          {loading ? 'Activating...' : isMissingInDb ? '🔄 Re-Sync Alerts Now' : 'Enable Alerts'}
        </button>
        <button
          type="button"
          className="notif-btn notif-btn--ghost"
          onClick={handleDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
