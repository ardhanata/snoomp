import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import './styles/theme.css'

// Log the running bundle so a stale deploy is identifiable from the console
// without diffing asset hashes.
console.info(`Snoomp frontend ${__APP_BUILD__}`)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </ErrorBoundary>,
)
