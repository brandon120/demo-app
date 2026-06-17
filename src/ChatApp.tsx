import { FormEvent, useEffect, useRef, useState } from "react";
import { api, type Message, type User } from "./api";
import { useAuth } from "./AuthContext";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string) {
  return name
    .split(/[\s_]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function ChatApp() {
  const { user, signout } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  useEffect(() => {
    api
      .users()
      .then(({ users: allUsers }) => {
        setUsers(allUsers);
        if (allUsers.length > 0) {
          setSelectedUserId(allUsers[0].id);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingUsers(false));
  }, []);

  useEffect(() => {
    if (!selectedUserId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setError("");

    const load = () => {
      api
        .messages(selectedUserId)
        .then(({ messages: thread }) => {
          if (!cancelled) setMessages(thread);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoadingMessages(false);
        });
    };

    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedUserId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedUserId || !draft.trim() || sending) return;

    setSending(true);
    setError("");

    try {
      const { message } = await api.sendMessage(selectedUserId, draft.trim());
      setMessages((prev) => [...prev, message]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="logo-mark">D</div>
          <div>
            <strong>Demo Chat</strong>
            <span>SQLite auth &amp; messaging</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="user-pill">
            <span className="avatar sm">{initials(user!.username)}</span>
            {user!.username}
          </span>
          <button type="button" className="ghost-btn" onClick={() => signout()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="chat-layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>People</h2>
            <span>{users.length} online</span>
          </div>

          {loadingUsers ? (
            <p className="muted">Loading users…</p>
          ) : users.length === 0 ? (
            <p className="muted">
              No other users yet. Open another tab and sign up to start chatting.
            </p>
          ) : (
            <ul className="user-list">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={
                      selectedUserId === u.id ? "user-item active" : "user-item"
                    }
                    onClick={() => setSelectedUserId(u.id)}
                  >
                    <span className="avatar">{initials(u.username)}</span>
                    <span className="user-meta">
                      <strong>{u.username}</strong>
                      <small>{u.email}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="chat-panel">
          {selectedUser ? (
            <>
              <div className="chat-header">
                <span className="avatar">{initials(selectedUser.username)}</span>
                <div>
                  <strong>{selectedUser.username}</strong>
                  <small>Direct message</small>
                </div>
              </div>

              <div className="messages">
                {loadingMessages && messages.length === 0 ? (
                  <p className="muted center">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="muted center">
                    No messages yet. Say hello to {selectedUser.username}!
                  </p>
                ) : (
                  messages.map((msg) => {
                    const mine = msg.sender_id === user!.id;
                    return (
                      <div
                        key={msg.id}
                        className={mine ? "bubble-row mine" : "bubble-row"}
                      >
                        <div className={mine ? "bubble mine" : "bubble"}>
                          <p>{msg.content}</p>
                          <time>{formatTime(msg.created_at)}</time>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {error && <p className="error-inline">{error}</p>}

              <form className="composer" onSubmit={handleSend}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Message ${selectedUser.username}…`}
                  disabled={sending}
                />
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={sending || !draft.trim()}
                >
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="empty-chat">
              <h3>Select someone to chat</h3>
              <p className="muted">
                Choose a user from the sidebar or invite a friend to sign up.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
