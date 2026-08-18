import { AlertTriangle, Lock, SearchX, WifiOff } from "lucide-react";
import { ClientApiError } from "../api/client";
import type { ResourceState } from "../api/use-resource";
import { Loading } from "../pages/dashboard-page";

// RPG-1.0-BATCH4: peça visual que acompanha useResource — cada página troca
// `if (!data) return <Loading/>;` por `if (resource.status !== 'success') return
// <ResourceFallback state={resource} onRetry={resource.reload}/>;`. Cobre os casos do
// pedido: loading, 404 (recurso inexistente OU sem autorização — o backend nunca diferencia
// os dois por design, ver Seção 17 do CLAUDE.md, então a mensagem também não diferencia,
// para não vazar existência), 401 (sessão expirada — tratado globalmente em
// auth-context.tsx, este componente nem chega a aparecer porque <Protected/> já redireciona
// para /login antes do próximo render), 403 (não usado hoje pelo backend, mas tratado aqui
// por completude/robustez — não exige nenhuma mudança de backend), 5xx e falha de rede
// (fetch rejeitado sem status HTTP) caem no mesmo estado genérico com "Tentar novamente".
export function ErrorState({ icon: Icon, title, text, onRetry }: { icon: typeof AlertTriangle; title: string; text: string; onRetry?: () => void }) {
  return (
    <div className="empty-state error-state">
      <Icon aria-hidden="true" />
      <h3>{title}</h3>
      <p>{text}</p>
      {onRetry && <button type="button" className="secondary-button" onClick={onRetry}>Tentar novamente</button>}
    </div>
  );
}

export function ResourceFallback({ state, onRetry }: { state: Exclude<ResourceState<unknown>, { status: "success" }>; onRetry?: () => void }) {
  if (state.status === "loading") return <Loading />;
  const error = state.error;
  if (error instanceof ClientApiError && error.status === 404) {
    return <ErrorState icon={SearchX} title="Não encontrado" text="Este conteúdo não existe ou não está mais disponível." />;
  }
  if (error instanceof ClientApiError && error.status === 403) {
    return <ErrorState icon={Lock} title="Acesso negado" text="Você não tem permissão para ver este conteúdo." />;
  }
  if (error instanceof ClientApiError && error.status === 401) {
    // Sessão expirada: client.ts já disparou o evento global (auth-context.tsx) que vai
    // trocar `user` para null e <Protected/> vai redirecionar para /login. Este estado é
    // só uma ponte visual para o instante entre o erro e o redirect (evita mostrar
    // "Tentar novamente" ou vazar a mensagem interna do erro).
    return <Loading />;
  }
  // 5xx ou falha de rede (TypeError do fetch, sem ClientApiError) — nunca expõe a mensagem
  // crua do erro (pode conter detalhe interno); mensagem genérica + retry.
  return <ErrorState icon={error instanceof ClientApiError ? AlertTriangle : WifiOff} title="Não foi possível carregar" text="Tente novamente em instantes." onRetry={onRetry} />;
}
