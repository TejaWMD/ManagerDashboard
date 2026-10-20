import React, { useState } from 'react';
import { UserAccount, UserRole } from '../../types';
import { authenticateUser, AUTHORIZED_USERS, ROLE_META } from '../../data/users';
import './Login.css';

interface LoginProps {
  onLoginSuccess: (user: UserAccount) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('account_manager');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showQuickAccess, setShowQuickAccess] = useState(false);

  const handleRoleChange = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both your email address and password.');
      return;
    }

    const result = authenticateUser(email, password, selectedRole);
    if (!result.success || !result.user) {
      setErrorMsg(result.error || 'Authentication failed.');
      return;
    }

    onLoginSuccess(result.user);
  };

  const handleQuickFill = (account: UserAccount) => {
    setSelectedRole(account.role);
    setEmail(account.email);
    setPassword(account.password);
    setErrorMsg(null);
  };

  const roleUsers = AUTHORIZED_USERS.filter((u) => u.role === selectedRole);

  return (
    <div className="login-page">
      <div className="login-bg-glow login-bg-glow--one" />
      <div className="login-bg-glow login-bg-glow--two" />

      <div className="login-container">
        {/* Left Branding Panel */}
        <div className="login-brand-panel">
          <div className="login-brand-header">
            <div className="login-logo-mark">WM</div>
            <div>
              <span className="login-brand-badge">ENTERPRISE PORTAL</span>
              <h1 className="login-brand-title">Management &amp; Complaint System</h1>
            </div>
          </div>

          <p className="login-brand-description">
            Role-restricted workspace designed for Account Managers, Operations Managers, and System Administrators.
            Optimized for TV Command Displays, Laptops, and Mobile Devices.
          </p>

          <div className="login-role-cards-preview">
            <div
              className={`login-tier-item ${
                selectedRole === 'account_manager' ? 'login-tier-item--active' : ''
              }`}
              onClick={() => handleRoleChange('account_manager')}
            >
              <span className="login-tier-dot login-tier-dot--am" />
              <div>
                <h4>Account Managers</h4>
                <p>Dedicated access for Shakti, Kavita &amp; Linda to log and track client complaints.</p>
              </div>
            </div>

            <div
              className={`login-tier-item ${
                selectedRole === 'manager' ? 'login-tier-item--active' : ''
              }`}
              onClick={() => handleRoleChange('manager')}
            >
              <span className="login-tier-dot login-tier-dot--mgr" />
              <div>
                <h4>Managers</h4>
                <p>Dedicated access for Teja to review, escalate, and update resolution statuses.</p>
              </div>
            </div>

            <div
              className={`login-tier-item ${
                selectedRole === 'admin' ? 'login-tier-item--active' : ''
              }`}
              onClick={() => handleRoleChange('admin')}
            >
              <span className="login-tier-dot login-tier-dot--adm" />
              <div>
                <h4>Admin</h4>
                <p>Full executive oversight, cross-team analytics, and system administration.</p>
              </div>
            </div>
          </div>

          <div className="login-device-support">
            <span>Responsive Ready:</span>
            <span className="device-pill">TV / 4K Wall</span>
            <span className="device-pill">Laptop / Desktop</span>
            <span className="device-pill">Mobile / Tablet</span>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="login-form-panel">
          <div className="login-form-header">
            <span className="login-step-label">STEP 1: SELECT ACCESS CATEGORY</span>
            <div className="role-selector-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'account_manager'}
                className={`role-tab ${selectedRole === 'account_manager' ? 'role-tab--active' : ''}`}
                onClick={() => handleRoleChange('account_manager')}
              >
                Account Manager
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'manager'}
                className={`role-tab ${selectedRole === 'manager' ? 'role-tab--active' : ''}`}
                onClick={() => handleRoleChange('manager')}
              >
                Manager
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedRole === 'admin'}
                className={`role-tab ${selectedRole === 'admin' ? 'role-tab--active' : ''}`}
                onClick={() => handleRoleChange('admin')}
              >
                Admin
              </button>
            </div>
          </div>

          <div className="login-active-role-banner" data-role={selectedRole}>
            <div className="login-active-role-title">{ROLE_META[selectedRole].title}</div>
            <div className="login-active-role-subtitle">{ROLE_META[selectedRole].subtitle}</div>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {errorMsg && (
              <div className="login-error-alert" role="alert">
                <span className="login-error-icon">!</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="login-email">Authorized Email Address</label>
              <input
                id="login-email"
                type="email"
                className="form-input"
                placeholder={
                  selectedRole === 'account_manager'
                    ? 'e.g. wmdklshakti@gmail.com'
                    : selectedRole === 'manager'
                    ? 'e.g. wmgteja@gmail.com'
                    : 'e.g. admin1@gmail.com'
                }
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Access Password</label>
              <div className="password-input-wrapper">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Enter your 6-digit password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" className="login-submit-btn" data-role={selectedRole}>
              Sign In as {ROLE_META[selectedRole].shortTitle}
            </button>
          </form>

          {/* Authorized Accounts Reference Helper */}
          <div className="login-credentials-helper">
            <button
              type="button"
              className="credentials-helper-toggle"
              onClick={() => setShowQuickAccess((prev) => !prev)}
            >
              <span>
                Authorized {ROLE_META[selectedRole].shortTitle} Accounts ({roleUsers.length})
              </span>
              <span>{showQuickAccess ? '▲ Hide' : '▼ Quick Fill'}</span>
            </button>

            {showQuickAccess && (
              <div className="credentials-list">
                {roleUsers.map((u) => (
                  <div key={u.id} className="credential-chip" onClick={() => handleQuickFill(u)}>
                    <div className="credential-chip-info">
                      <strong>{u.name}</strong>
                      <span>{u.email}</span>
                    </div>
                    <div className="credential-chip-pass">
                      <code>PW: {u.password}</code>
                      <span className="credential-fill-tag">Click to fill</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
