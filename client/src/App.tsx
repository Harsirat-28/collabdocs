import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthInit } from "./features/auth/useAuthInit";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentEditorPage } from "./pages/DocumentEditorPage";

export default function App() {
  useAuthInit();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents/:id"
        element={
          <ProtectedRoute>
            <DocumentEditorPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
