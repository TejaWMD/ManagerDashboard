import React, { useState } from 'react';
import { UserAccount, UserRole } from '../../types';
import { authenticateUser } from '../../data/users';
import wmdLogo from '../../assets/wmd-logo.jpg';
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

  const handleRoleChange = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter your email and password.');
      return;
    }

    const result = authenticateUser(email, password, selectedRole);
    if (!result.success || !result.user) {
      setErrorMsg(result.error || 'Authentication failed.');
      return;
    }

    onLoginSuccess(result.user);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo-container">
            <img
              src={wmdLogo}
              alt="WMD Company Logo"
              className="login-company-logo"
            />
          </div>
          <div className="login-title-group">
            <h1 className="login-title">Sign In</h1>
            <p className="login-portal-subtitle">WMD Query Portal</p>
          </div>
        </div>

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

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {errorMsg && (
            <div className="login-error-alert" role="alert">
              {errorMsg}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              placeholder="Enter email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <div className="password-input-wrapper">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="Enter password"
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

          <button type="submit" className="login-submit-btn">
            Login
          </button>
        </form>
      </div>
    </div>
  );
};
