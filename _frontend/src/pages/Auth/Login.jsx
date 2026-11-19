import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Sun, Moon, Eye, EyeOff } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { useAuth } from "../../contexts/AuthContext";
import { signInWithFirebase } from "../../utils/firebase";
import { persistAuthTokens } from "../../utils/authCookies";
import InfoModal from "./InfoModal";
import Tooltip from "../../components/Tooltip";
import "./Auth.css";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [alertmsg, setAlertmsg] = useState(
    location.state?.sessionExpired || new URLSearchParams(location.search).get('sessionExpired')
      ? "Session expired. Please sign in again."
      : ""
  );
  const [alertColor, setAlertColor] = useState(
    location.state?.sessionExpired || new URLSearchParams(location.search).get('sessionExpired')
      ? "text-error"
      : ""
  );
  const [isConsentChecked, setIsConsentChecked] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clearAlert = () => { setAlertmsg(""); setAlertColor(""); };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      setAlertmsg("Please enter both email and password.");
      setAlertColor("text-error");
      return;
    }

    if (!isConsentChecked) {
      setAlertmsg("Please agree to the Terms of Use and Privacy Policy.");
      setAlertColor("text-error");
      return;
    }

    try {
      setIsSubmitting(true);
      const tokens = await signInWithFirebase(email, password);
      persistAuthTokens(tokens);
      login(email);
      navigate("/google-connect");
    } catch (error) {
      const code = error?.code || '';
      let friendlyMessage = 'Login failed. Please try again.';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        friendlyMessage = 'Incorrect email or password. Please try again.';
      } else if (code === 'auth/too-many-requests') {
        friendlyMessage = 'Too many attempts. Please wait a moment and try again.';
      } else if (code === 'auth/user-disabled') {
        friendlyMessage = 'This account has been disabled. Please contact your administrator.';
      } else if (error?.message) {
        friendlyMessage = error.message;
      }
      setAlertmsg(friendlyMessage);
      setAlertColor('text-error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-container" data-theme={theme}>
      <div className="auth-background" />

      <Tooltip content={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} placement="bottom">
        <button onClick={toggleTheme} className="theme-toggle">
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
      </Tooltip>

      <div className="auth-card">
        <h1 className="auth-title">Wealth Management Platform</h1>
        <h2 className="auth-welcome">Welcome Back</h2>
        <p className="auth-subtitle">Please sign in to continue</p>

        <form onSubmit={handleSubmit} className="auth-form">

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={clearAlert}
              placeholder="Enter your email"
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <div className="form-group--password">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={clearAlert}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <Tooltip content={showPassword ? 'Hide password' : 'Show password'} placement="left">
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(p => !p)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="link-button" onClick={() => navigate("/forgot-password")}>
              Forgot password?
            </button>
          </div>

          <div className="consent-checkbox">
            <label>
              <input
                type="checkbox"
                checked={isConsentChecked}
                onChange={(e) => { setIsConsentChecked(e.target.checked); clearAlert(); }}
              />
              <span>
                I agree to the{" "}
                <button type="button" className="link-inline" onClick={() => setActiveModal("terms")}>
                  Terms of Use
                </button>{" "}
                and{" "}
                <button type="button" className="link-inline" onClick={() => setActiveModal("privacy")}>
                  Privacy Policy
                </button>
              </span>
            </label>
          </div>

          {alertmsg && <p className={`alert-message ${alertColor}`}>{alertmsg}</p>}

          <button type="submit" disabled={isSubmitting} className="submit-button">
            {isSubmitting ? "Signing In..." : "Sign In"}
          </button>

          <p className="auth-switch">
            Don't have an account?{" "}
            <button type="button" className="link-inline" onClick={() => navigate("/signup")}>
              Sign Up
            </button>
          </p>
        </form>

        <footer className="auth-footer">
          <button type="button" onClick={() => setActiveModal("terms")}>Terms of Use</button>
          <span>|</span>
          <button type="button" onClick={() => setActiveModal("compatibility")}>Browser Compatibility</button>
          <span>|</span>
          <button type="button" onClick={() => setActiveModal("privacy")}>Privacy Policy</button>
          <span>|</span>
          <span>© 2026 Wealth Management</span>
        </footer>
      </div>

      <InfoModal type={activeModal} onClose={() => setActiveModal(null)} />
    </div>
  );
}
