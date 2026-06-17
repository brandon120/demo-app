import { AuthForm } from "./AuthForm";
import { ChatApp } from "./ChatApp";
import { useAuth } from "./AuthContext";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="spinner" />
        <p>Loading Demo Chat…</p>
      </main>
    );
  }

  return user ? <ChatApp /> : <AuthForm />;
}
