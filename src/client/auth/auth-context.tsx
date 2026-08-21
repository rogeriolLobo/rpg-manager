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
import { bumpSessionEpoch } from "../api/session-epoch";

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
  const initialSessionStarted = useRef(false);
  const setUser = useCallback((nextUser: User | null) => {
    authVersion.current += 1;
    // Toda troca de identidade de sessão (login, registro, logout, expiração) invalida
    // requisições em voo emitidas ANTES dela — ver session-epoch.ts.
    bumpSessionEpoch();
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
    // O StrictMode repete efeitos no mount em desenvolvimento. Uma segunda checagem de
    // sessão não só duplica este GET: ao resolver com outro objeto User, ela reinicia também
    // os providers de tema, World e notificações. A checagem inicial deve ocorrer uma vez;
    // refresh/login continuam controlados pelos métodos explícitos acima.
    if (initialSessionStarted.current) return;
    initialSessionStarted.current = true;
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
  // RPG-1.0-BATCH4: qualquer chamada de API em qualquer página que receba 401
  // UNAUTHENTICATED (ver src/client/api/client.ts) derruba a sessão aqui, uma vez, de forma
  // centralizada — a rota <Protected/> (src/client/app.tsx) já redireciona para /login
  // assim que `user` vira null. Sem isto, uma sessão expirada em segundo plano deixava a
  // página presa em "Carregando…" para sempre (a chamada falhava, ninguém tratava o erro).
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('rpg:unauthenticated', onExpired);
    return () => window.removeEventListener('rpg:unauthenticated', onExpired);
  }, [setUser]);
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
