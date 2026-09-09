import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

const ROLE_LABEL = {
  staff: 'Staff-in-Charge',
  finance: 'Finance Officer',
  director: 'Director',
  trustee: 'Trustee',
  admin: 'System Admin'
};

export function Rail() {
  const { user, logout } = useAuth();
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passwordMessage, setPasswordMessage] = useState(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const isApprover = ['finance', 'director', 'trustee', 'admin'].includes(user.role);

  async function handlePasswordChange(event) {
    event.preventDefault();
    setPasswordMessage(null);
    if (passwords.next !== passwords.confirm) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(passwords.current, passwords.next);
      setPasswords({ current: '', next: '', confirm: '' });
      setPasswordMessage({ type: 'success', text: 'Password changed successfully.' });
    } catch (err) {
      setPasswordMessage({ type: 'error', text: err.message });
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <nav className="rail">
      <div className="rail-brand">ChallengeAid</div>
      <div className="rail-sub">Disbursement Tracker</div>

      <div className="rail-nav">
        <NavLink to="/" end className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
          Requests
        </NavLink>
        {(user.role === 'staff' || user.role === 'admin') && (
          <NavLink to="/new-request" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
            New Request
          </NavLink>
        )}
        {isApprover && (
          <NavLink to="/dashboard" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
            Dashboard
          </NavLink>
        )}
        {user.role === 'admin' && (
          <>
            <NavLink to="/admin/centres" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              SOH Centers
            </NavLink>
            <NavLink to="/admin/budget-lines" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              Budget Lines
            </NavLink>
            <NavLink to="/admin/users" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              Users
            </NavLink>
          </>
        )}
      </div>

      <div className="rail-user">
        {user.name}
        <span className="rail-user-role">{ROLE_LABEL[user.role] || user.role}</span>
        <button className="rail-logout" onClick={() => { setShowPasswordForm((visible) => !visible); setPasswordMessage(null); }}>
          {showPasswordForm ? 'Close password form' : 'Change password'}
        </button>
        {showPasswordForm && (
          <form className="rail-password-form" onSubmit={handlePasswordChange}>
            <input type="password" placeholder="Current password" value={passwords.current} onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))} required />
            <input type="password" placeholder="New password (8+ chars)" minLength={8} value={passwords.next} onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))} required />
            <input type="password" placeholder="Confirm new password" minLength={8} value={passwords.confirm} onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))} required />
            {passwordMessage && <span className={passwordMessage.type === 'error' ? 'rail-password-error' : 'rail-password-success'}>{passwordMessage.text}</span>}
            <button type="submit" className="rail-logout" disabled={passwordBusy}>{passwordBusy ? 'Changing…' : 'Update password'}</button>
          </form>
        )}
        <button className="rail-logout" onClick={logout}>Log out</button>
      </div>
    </nav>
  );
}
