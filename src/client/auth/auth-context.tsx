import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, postJson } from "../api/client";

export interface User {
  id: string;
  email: string;
  displayName: string;
}
interface AuthContextValue {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authVersion = useRef(0);
  const setUser = useCallback((nextUser: User | null) => {
    authVersion.current += 1;
    setUserState(nextUser);
    setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    const requestVersion = authVersion.current + 1;
    authVersion.current = requestVersion;
    try {
      const result = await api<{ user: User }>("/auth/session");
      if (authVersion.current === requestVersion) setUserState(result.user);
    } catch {
      if (authVersion.current === requestVersion) setUserState(null);
    } finally {
      if (authVersion.current === requestVersion) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const requestVersion = authVersion.current;
    void api<{ user: User }>("/auth/session")
      .then((result) => {
        if (authVersion.current === requestVersion) setUserState(result.user);
      })
      .catch(() => {
        if (authVersion.current === requestVersion) setUserState(null);
      })
      .finally(() => {
        if (authVersion.current === requestVersion) setLoading(false);
      });
  }, []);
  const logout = useCallback(async () => {
    await postJson("/auth/logout", {});
    setUser(null);
  }, [setUser]);
  const value = useMemo(
    () => ({ user, loading, refresh, logout, setUser }),
    [user, loading, refresh, logout, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider ausente");
  return value;
}
