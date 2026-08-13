import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, patchJson } from '../api/client';
import { useAuth } from '../auth/auth-context';

export interface ActiveWorldOption {
  id: string;
  name: string;
  visibility: 'PRIVATE' | 'GROUP';
  isOwner: boolean;
}

interface ActiveWorldContextValue {
  worlds: ActiveWorldOption[];
  activeWorld: ActiveWorldOption | null;
  loading: boolean;
  setActiveWorldId: (worldId: string | null) => Promise<void>;
  refreshWorlds: () => Promise<void>;
}

const ActiveWorldContext = createContext<ActiveWorldContextValue | null>(null);

async function fetchWorldState(): Promise<{ worlds: ActiveWorldOption[]; preferredId: string | null }> {
  const [worldResult, preference] = await Promise.all([
    api<{ items: ActiveWorldOption[] }>('/worlds?pageSize=50&archive=active&sort=name'),
    api<{ activeWorldId: string | null }>('/preferences/active-world'),
  ]);
  return { worlds: worldResult.items, preferredId: preference.activeWorldId };
}

export function ActiveWorldProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [worlds, setWorlds] = useState<ActiveWorldOption[]>([]);
  const [activeWorldId, setActiveWorldIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshWorlds = useCallback(async () => {
    if (!user) { setWorlds([]); setActiveWorldIdState(null); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await fetchWorldState();
      setWorlds(result.worlds);
      const selectedId = result.worlds.some((world) => world.id === result.preferredId)
        ? result.preferredId
        : result.worlds[0]?.id ?? null;
      setActiveWorldIdState(selectedId);
      if (selectedId !== result.preferredId) await patchJson('/preferences/active-world', { activeWorldId: selectedId });
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void fetchWorldState().then(async (result) => {
      if (!active) return;
      const selectedId = result.worlds.some((world) => world.id === result.preferredId) ? result.preferredId : result.worlds[0]?.id ?? null;
      setWorlds(result.worlds); setActiveWorldIdState(selectedId); setLoading(false);
      if (selectedId !== result.preferredId) await patchJson('/preferences/active-world', { activeWorldId: selectedId });
    });
    return () => { active = false; };
  }, [user]);

  const setActiveWorldId = useCallback(async (worldId: string | null) => {
    const previous = activeWorldId; setActiveWorldIdState(worldId);
    try { await patchJson('/preferences/active-world', { activeWorldId: worldId }); }
    catch (error) { setActiveWorldIdState(previous); throw error; }
  }, [activeWorldId]);

  const value = useMemo<ActiveWorldContextValue>(() => ({
    worlds,
    activeWorld: worlds.find((world) => world.id === activeWorldId) ?? null,
    loading,
    setActiveWorldId,
    refreshWorlds,
  }), [activeWorldId, loading, refreshWorlds, setActiveWorldId, worlds]);

  return <ActiveWorldContext.Provider value={value}>{children}</ActiveWorldContext.Provider>;
}

export function useActiveWorld(): ActiveWorldContextValue {
  const value = useContext(ActiveWorldContext);
  if (!value) throw new Error('ActiveWorldProvider ausente');
  return value;
}
