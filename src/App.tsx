import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'

// Dashboard is the landing screen, so it stays eager. Login and ProjectDetail
// are split into their own chunks to keep the initial bundle small.
const Login = lazy(() => import('./pages/Login'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
// Public, no-login client selections page (its own chunk).
const ClientSelections = lazy(() => import('./pages/ClientSelections'))
// Public, no-login read-only progress view for interested parties.
const ProjectView = lazy(() => import('./pages/ProjectView'))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber border-t-transparent" />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public client page — no auth, no redirect. */}
          <Route path="/s/:token" element={<ClientSelections />} />
          {/* Public read-only progress view for interested parties. */}
          <Route path="/v/:token" element={<ProjectView />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/project/:id"
            element={
              <ProtectedRoute>
                <Layout>
                  <ProjectDetail />
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
