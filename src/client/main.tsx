import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import { AuthProvider } from './auth/auth-context';
import './styles.css';
import './layout-fixes.css';

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter></StrictMode>);
