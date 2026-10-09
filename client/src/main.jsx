import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Kiosk from './pages/Kiosk.jsx';
import Counter from './pages/Counter.jsx';
import Display from './pages/Display.jsx';
import Admin from './pages/Admin.jsx';
import Portal from './pages/Portal.jsx';
import TicketStatus from './pages/TicketStatus.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/display" element={<Display />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/ticket/:id" element={<TicketStatus />} />

          {/* Staff */}
          <Route path="/counter" element={<RequireAuth><Counter /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth role="admin"><Admin /></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
