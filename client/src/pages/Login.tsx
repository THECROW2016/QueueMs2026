import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth';
import { errorMessage } from '../lib/api';
import './Login.css';

const features: Array<{ icon: string; title: string; description: string; color: string }> = [
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


const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username or email'),
  password: z.string().min(1, 'Enter your password'),
});
type Form = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, signIn } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to={safeNext(params.get('next')) ?? '/'} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setMessage('');
    try {
      await signIn(values.username, values.password);
      navigate(safeNext(params.get('next')) ?? '/', { replace: true });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  });

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
              <span className="brand-word">Afri<span>Queue</span></span>
            </a>
            <p>Hospital Queue Management System</p>
          </div>

          <div className="login-heading">
            <div className="login-logo"><span className="brand-symbol">A</span></div>
            <h2>Welcome Back</h2>
            <p>Sign in to your account</p>
          </div>

          <form className="login-form" onSubmit={onSubmit} noValidate>
            <label htmlFor="username">Username or Email</label>
            <div className="input-wrap">
              <span className="input-icon">✉</span>
              <input id="username" type="text" autoComplete="username" placeholder="Enter your username or email" aria-invalid={!!errors.username} {...register('username')} />
            </div>
            {errors.username && <div className="form-message" role="alert">{errors.username.message}</div>}

            <label htmlFor="password">Password</label>
            <div className="input-wrap">
              <span className="input-icon">♙</span>
              <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" aria-invalid={!!errors.password} {...register('password')} />
              <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.password && <div className="form-message" role="alert">{errors.password.message}</div>}

            <div className="form-options">
              <span />
              <button className="text-button" type="button" onClick={() => setMessage('Please ask your system administrator to reset your password.')}>
                Forgot password?
              </button>
            </div>

            {message && <div className="form-message" role="alert">{message}</div>}

            <button className="login-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Please wait...' : 'Login'}
              <span>→</span>
            </button>
          </form>

          <div className="or-divider"><span /><small>OR</small><span /></div>

          <div className="alternative-access">
            <Link to="/display" className="alt-link">
              <span className="access-icon">▦</span>
              <span>
                <strong>Waiting-room display</strong>
                <small>Public queue screen</small>
              </span>
            </Link>
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

/** Only follow same-site paths after sign-in (never an absolute or protocol-relative URL). */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null;
}
