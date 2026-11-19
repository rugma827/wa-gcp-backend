import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { completeNewPassword } from "../../utils/cognito";
import { persistAuthTokens } from "../../utils/authCookies";
import "./Auth.css";

export default function ChangePassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const cognitoUser = location.state?.cognitoUser;
  const email = location.state?.email || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [alertmsg, setAlertmsg] = useState("");
  const [alertColor, setAlertColor] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!cognitoUser) {
    navigate("/login", { replace: true });
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setAlertmsg("Passwords do not match.");
      setAlertColor("text-error");
      return;
    }
    if (newPassword.length < 8) {
      setAlertmsg("Password must be at least 8 characters.");
      setAlertColor("text-error");
      return;
    }
    try {
      setIsSubmitting(true);
      const tokens = await completeNewPassword(cognitoUser, newPassword);
      persistAuthTokens(tokens);
      login(email);
      navigate("/google-connect");
    } catch (error) {
      setAlertmsg(error.message || "Password change failed. Please try again.");
      setAlertColor("text-error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-background" />
      <div className="auth-card">
        <h1 className="auth-title">Wealth Management Platform</h1>
        <h2 className="auth-welcome">Set New Password</h2>
        <p className="auth-subtitle">You must set a new password before continuing.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              required
            />
          </div>

          {alertmsg && <p className={`alert-message ${alertColor}`}>{alertmsg}</p>}

          <button type="submit" disabled={isSubmitting} className="submit-button">
            {isSubmitting ? "Saving..." : "Set Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
