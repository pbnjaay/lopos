import { Navigate, createBrowserRouter } from "react-router-dom"

import { RequireAuth } from "../features/auth/RequireAuth"
import { SessionRoute } from "../features/cash-session/SessionRoute"
import { AppEntryPage } from "../pages/AppEntryPage"
import { CashSessionReportPage } from "../pages/CashSessionReportPage"
import { CloseCashSessionPage } from "../pages/CloseCashSessionPage"
import { LoginPage } from "../pages/LoginPage"
import { OpenCashSessionPage } from "../pages/OpenCashSessionPage"
import { PendingSalesPage } from "../pages/PendingSalesPage"
import { PosPage } from "../pages/PosPage"
import { SaleReceiptPage } from "../pages/SaleReceiptPage"
import { SaleDetailPage } from "../pages/SaleDetailPage"
import { SaleReturnPage } from "../pages/SaleReturnPage"
import { SaleReturnReceiptPage } from "../pages/SaleReturnReceiptPage"
import { SalesPage } from "../pages/SalesPage"

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
      {
        path: "/cash-sessions/:sessionId/report",
        element: <CashSessionReportPage />,
      },
      {
        path: "/sales/pending",
        element: <PendingSalesPage />,
      },
      {
        path: "/sales/:saleId/receipt",
        element: <SaleReceiptPage />,
      },
      { path: "/sales", element: <SessionRoute requireOpen><SalesPage /></SessionRoute> },
      { path: "/sales/:saleId", element: <SessionRoute requireOpen><SaleDetailPage /></SessionRoute> },
      { path: "/sales/:saleId/return", element: <SessionRoute requireOpen><SaleReturnPage /></SessionRoute> },
      { path: "/returns/new", element: <Navigate to="/sales" replace /> },
      { path: "/returns/:returnId/receipt", element: <SessionRoute requireOpen><SaleReturnReceiptPage /></SessionRoute> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
])
