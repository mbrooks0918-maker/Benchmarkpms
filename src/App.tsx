import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'

// Dashboard is the landing screen, so it stays eager. Login and ProjectDetail
// are split into their own chunks to keep the initial bundle small.
const Login = lazy(() => import('./pages/Login'))
const SignUp = lazy(() => import('./pages/SignUp'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const Team = lazy(() => import('./pages/Team'))
// Public, no-login client selections page (its own chunk).
const ClientSelections = lazy(() => import('./pages/ClientSelections'))
// Public, no-login read-only progress view for interested parties.
const ProjectView = lazy(() => import('./pages/ProjectView'))
// Public, no-login invite acceptance page.
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'))
// Public, no-login change-order signing page.
const SignChangeOrder = lazy(() => import('./pages/SignChangeOrder'))
// Public password-reset page (arrived-from-email recovery session).
const ResetPassword = lazy(() => import('./pages/ResetPassword'))

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
          {/* Public invite acceptance — no auth (the visitor isn't a user yet). */}
          <Route path="/accept-invite" element={<AcceptInvite />} />
          {/* Public change-order signing — no auth. */}
          <Route path="/sign/:token" element={<SignChangeOrder />} />
          {/* Public password reset (recovery session from email link). */}
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
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
          <Route
            path="/team"
            element={
              <ProtectedRoute>
                <Layout>
                  <Team />
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
