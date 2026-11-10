import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {BrowserRouter} from "react-router-dom";
import "./style/global.css"
import App from './App.jsx'
import { createAdminSessionController } from './lib/admin-session-controller'
import { CookieAdminSessionProvider } from './components/CookieAdminSession'
import { configureAdminCookieClient } from './lib/api'
const adminClient=createAdminSessionController()
configureAdminCookieClient(adminClient)


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <CookieAdminSessionProvider client={adminClient}><App /></CookieAdminSessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
