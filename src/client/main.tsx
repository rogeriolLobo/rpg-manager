import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import { AuthProvider } from './auth/auth-context';
import { ThemeProvider } from './theme/ThemeProvider';
import './theme/tokens.css';
import './styles.css';
import './layout-fixes.css';
import './group-pages.css';
import './vault-pages.css';

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><AuthProvider><ThemeProvider><App/></ThemeProvider></AuthProvider></BrowserRouter></StrictMode>);
