import { Navigate, createBrowserRouter } from "react-router-dom"

import { SetupPage } from "../pages/SetupPage"

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/login" replace /> },
  {
    path: "/login",
    element: <SetupPage title="Connexion" nextStep="L’authentification arrive à l’étape 2." />,
  },
  {
    path: "/cash/open",
    element: (
      <SetupPage
        title="Ouverture de caisse"
        nextStep="L’ouverture de caisse arrive à l’étape 3."
      />
    ),
  },
  {
    path: "/pos",
    element: <SetupPage title="Point de vente" nextStep="L’écran POS sera assemblé à l’étape 6." />,
  },
  { path: "*", element: <Navigate to="/login" replace /> },
])
