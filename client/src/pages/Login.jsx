import React, { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import "./Login.css";

const features = [
  {
    icon: "♟",
    title: "Queue Management",
    description: "Generate tokens, manage queues and call patients in real time.",
    color: "cyan",
  },
  {
    icon: "▣",
    title: "Live Display",
    description: "Show queue status on waiting-room screens and digital boards.",
    color: "purple",
  },
  {
    icon: "✚",
    title: "Doctor & Nurse Panels",
    description: "Manage consultations and patient flow across service rooms.",
    color: "purple",
  },
  {
    icon: "▥",
    title: "Reports & Analytics",
    description: "Track waiting times, service performance and patient flow.",
    color: "cyan",
  },
  {
    icon: "⬡",
    title: "Secure Access",
    description: "Separate user roles with controlled access to system features.",
    color: "blue",
  },
  {
    icon: "☁",
    title: "Cloud Ready",
    description: "Access the platform from authorized devices and locations.",
    color: "purple",
  },
];

function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, setUser } = useAuth();
  const [role, setRole] = useState("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (event) => {
    event.preventDefault();
    setMessage("");

    if (!username.trim() || !password) {
      setMessage("Please enter your username and password.");
      return;
    }

    setLoading(true);

    try {
      const result = await api("/auth/login", {
        username,
        password,
        role,
        rememberMe,
      });
      setUser(result.user);

      // Return to the page that asked for sign-in, if it is one this account may open.
      const next = params.get("next");
      const allowed =
        next === "/counter" || (next === "/admin" && result.user.role === "admin");
      navigate(allowed ? next : result.redirectUrl, { replace: true });
    } catch (error) {
      setMessage(error.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    setMessage(
      "Please ask your system administrator to reset your password."
    );
  };

  // Already signed in: go straight to the right workspace.
  if (user) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/counter"} replace />;
  }

  return (
    <main className="login-page">
      <div className="background-image" />
      <div className="background-overlay" />
      <div className="light-trail trail-one" />
      <div className="light-trail trail-two" />

      <div className="page-content">
        <section className="marketing-panel">
          <a href="#home" className="brand" id="home">
            <span className="brand-symbol">A</span>
            <span className="brand-word">
              Afri<span>Queue</span>
              <small>HOSPITAL QUEUE MANAGEMENT SYSTEM</small>
            </span>
          </a>

          <div className="hero-copy">
            <span className="eyebrow">
              <span className="online-dot" />
              SMARTER HOSPITALS. HAPPIER PATIENTS.
            </span>

            <h1>
              Less waiting.
              <br />
              <span>Better care.</span>
            </h1>

            <p>
              AfriQueue helps hospitals manage patient flow, reduce waiting
              times and coordinate healthcare services from one platform.
            </p>
          </div>

          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <div className={`feature-icon ${feature.color}`}>
                  {feature.icon}
                </div>

                <div>
                  <h2>{feature.title}</h2>
                  <p>{feature.description}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="stats-panel">
            <div className="stat">
              <span className="stat-icon">♙</span>
              <div>
                <small>QUEUE TOKENS</small>
                <strong>Real-time</strong>
                <span>Patient flow</span>
              </div>
            </div>

            <div className="stat">
              <span className="stat-icon">◷</span>
              <div>
                <small>WAITING TIMES</small>
                <strong>Trackable</strong>
                <span>By department</span>
              </div>
            </div>

            <div className="stat">
              <span className="stat-icon">⬡</span>
              <div>
                <small>ACCESS</small>
                <strong>Role-based</strong>
                <span>Staff permissions</span>
              </div>
            </div>
          </div>

          <div className="security-note">
            <span>⬡</span>
            <span>Designed for controlled access to healthcare workflows</span>
            <span className="security-divider">|</span>
            <span>AfriQueue Technologies Ltd.</span>
          </div>
        </section>

        <section className="login-panel">
          <div className="mobile-brand">
            <a href="#home" className="brand">
              <span className="brand-symbol">A</span>
              <span className="brand-word">
                Afri<span>Queue</span>
              </span>
            </a>
            <p>Hospital Queue Management System</p>
          </div>

          <div className="login-heading">
            <div className="login-logo">
              <span className="brand-symbol">A</span>
            </div>

            <h2>Welcome Back</h2>
            <p>Sign in to your account</p>
          </div>

          <div className="role-selector" aria-label="Choose account type">
            <button
              type="button"
              className={`role-option ${role === "admin" ? "selected" : ""}`}
              onClick={() => {
                setRole("admin");
                setMessage("");
              }}
              aria-pressed={role === "admin"}
            >
              <span className="role-icon">♟</span>
              <span>
                <strong>Admin</strong>
                <small>System Administrator</small>
              </span>
            </button>

            <button
              type="button"
              className={`role-option ${role === "user" ? "selected" : ""}`}
              onClick={() => {
                setRole("user");
                setMessage("");
              }}
              aria-pressed={role === "user"}
            >
              <span className="role-icon">♙</span>
              <span>
                <strong>User</strong>
                <small>Staff / Healthcare Provider</small>
              </span>
            </button>
          </div>

          <form className="login-form" onSubmit={handleLogin}>
            <label htmlFor="username">Username or Email</label>

            <div className="input-wrap">
              <span className="input-icon">✉</span>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="Enter your username or email"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>

            <label htmlFor="password">Password</label>

            <div className="input-wrap">
              <span className="input-icon">♙</span>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={
                  role === "admin" ? "current-password" : "current-password"
                }
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />

              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            <div className="form-options">
              <label className="remember-option">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Remember me</span>
              </label>

              <button
                className="text-button"
                type="button"
                onClick={handleForgotPassword}
              >
                Forgot password?
              </button>
            </div>

            {message && (
              <div className="form-message" role="status">
                {message}
              </div>
            )}

            <button
              className="login-button"
              type="submit"
              disabled={loading}
            >
              {loading ? "Please wait..." : "Login"}
              <span>→</span>
            </button>
          </form>

          <div className="or-divider">
            <span />
            <small>OR</small>
            <span />
          </div>

          <div className="alternative-access">
            <button
              type="button"
              onClick={() =>
                setMessage(
                  "QR login is not configured yet. Connect your approved QR authentication service."
                )
              }
            >
              <span className="access-icon">▦</span>
              <span>
                <strong>Scan QR Code</strong>
                <small>For quick access</small>
              </span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/portal")}
            >
              <span className="access-icon">◎</span>
              <span>
                <strong>Patient Portal</strong>
                <small>Check queue status</small>
              </span>
            </button>
          </div>

          <footer className="login-footer">
            <span>AfriQueue Technologies Ltd.</span>
            <span>Version 1.0.0</span>
          </footer>
        </section>
      </div>
    </main>
  );
}

export default Login;
