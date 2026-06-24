import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css' // Tailwind base/theme first…
import './styles.css' // …then legacy CSS wins for not-yet-migrated screens

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register the PWA service worker only in a real build — never in Vite dev,
// where a SW would fight HMR. Failures are non-fatal (the app still works).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
