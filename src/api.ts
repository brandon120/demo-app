export type User = {
  id: string;
  username: string;
  email: string;
  created_at: string;
};

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  sender: User;
  receiver: User;
};

const TOKEN_KEY = "demo_token";
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? "Request failed");
  }

  return data as T;
}

export const api = {
  signup(username: string, email: string, password: string) {
    return request<{ token: string; user: User }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
  },

  signin(email: string, password: string) {
    return request<{ token: string; user: User }>("/api/auth/signin", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  signout() {
    return request<{ ok: boolean }>("/api/auth/signout", { method: "POST" });
  },

  me() {
    return request<{ user: User }>("/api/auth/me");
  },

  users() {
    return request<{ users: User[] }>("/api/users");
  },

  messages(withUserId: string) {
    return request<{ messages: Message[] }>(
      `/api/messages?with=${encodeURIComponent(withUserId)}`,
    );
  },

  sendMessage(receiverId: string, content: string) {
    return request<{ message: Message }>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ receiverId, content }),
    });
  },
};
