import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import Kiosk from './pages/Kiosk.jsx';
import Counter from './pages/Counter.jsx';
import Display from './pages/Display.jsx';
import Admin from './pages/Admin.jsx';
import TicketStatus from './pages/TicketStatus.jsx';
import './styles.css';

function Home() {
  const links = [
    ['/kiosk', 'Kiosk', 'Customers pick a service and take a ticket'],
    ['/counter', 'Counter panel', 'Staff call, serve, skip and complete tickets'],
    ['/display', 'Display screen', 'Live board for the waiting area TV'],
    ['/admin', 'Setup', 'Add services and counters'],
  ];
  return (
    <main className="page home">
      <h1 className="brand">Queue<span>MS</span></h1>
      <p className="muted">Open each screen on the device where it will run.</p>
      <div className="home-grid">
        {links.map(([to, title, desc]) => (
          <Link key={to} to={to} className="card link-card">
            <strong>{title}</strong>
            <span className="muted">{desc}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/kiosk" element={<Kiosk />} />
        <Route path="/counter" element={<Counter />} />
        <Route path="/display" element={<Display />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/ticket/:id" element={<TicketStatus />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
