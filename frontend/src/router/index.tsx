import { Navigate, createBrowserRouter } from "react-router-dom"

import { RequireAuth } from "../features/auth/RequireAuth"
import { SessionRoute } from "../features/cash-session/SessionRoute"
import { AppEntryPage } from "../pages/AppEntryPage"
import { CloseCashSessionPage } from "../pages/CloseCashSessionPage"
import { LoginPage } from "../pages/LoginPage"
import { OpenCashSessionPage } from "../pages/OpenCashSessionPage"
import { PosPage } from "../pages/PosPage"

export const router = createBrowserRouter([
  { path: "/", element: <AppEntryPage /> },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/cash/open",
        element: (
          <SessionRoute requireOpen={false}>
            <OpenCashSessionPage />
          </SessionRoute>
        ),
      },
      {
        path: "/pos",
        element: (
          <SessionRoute requireOpen>
            <PosPage />
          </SessionRoute>
        ),
      },
      {
        path: "/cash/close",
        element: (
          <SessionRoute requireOpen>
            <CloseCashSessionPage />
          </SessionRoute>
        ),
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
])
