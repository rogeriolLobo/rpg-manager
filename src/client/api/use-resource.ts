import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ClientApiError } from './client';

// RPG-1.0-BATCH4: substitui o padrão `useEffect(() => { void api(path).then(setState) }, [dep])`
// espalhado por ~13 páginas, que não tratava falha nenhuma — um 404/401/5xx deixava a
// promise rejeitada sem handler e a página presa em "Carregando…" para sempre (achado real
// da auditoria de UX, ver docs/audit/RPG_MANAGER_1_0_MATRIX.md). Uma chamada por hook: quem
// precisa combinar mais de uma chamada (ex.: Promise.all) continua fazendo isso dentro do
// `fetcher`, que só roda de novo quando `path` muda.
//
// Estado "loading" é DERIVADO (comparando `result.path` com `path` atual) em vez de guardado
// via setState síncrono dentro do efeito — só chamamos setState dentro de callbacks
// assíncronos (`.then`/`.catch`) ou a partir de handlers de evento (`reload`/`mutate`), nunca
// de forma síncrona no corpo do efeito, para não gerar renders em cascata.
export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown };

type InternalResult<T> = { path: string; status: 'success'; data: T } | { path: string; status: 'error'; error: unknown };

export function useResource<T>(path: string | null, fetcher: (path: string) => Promise<T> = (p) => api<T>(p)): ResourceState<T> & { reload: () => void; mutate: (updater: (data: T) => T) => void } {
  const [result, setResult] = useState<InternalResult<T> | null>(null);
  const requestId = useRef(0);
  const pendingPath = useRef<string | null>(null);
  const fetcherRef = useRef(fetcher);
  // Mantém a closure mais recente do fetcher sem escrever no ref durante o render (só em
  // efeito, na ordem declarada — roda antes do efeito de carregamento abaixo).
  useEffect(() => { fetcherRef.current = fetcher; });

  const load = useCallback((currentPath: string) => {
    // O StrictMode executa setup→cleanup→setup dos efeitos no desenvolvimento. Reutilizar a
    // requisição já em voo evita duas leituras idênticas no Worker/D1 e, principalmente, evita
    // descartar a primeira resposta válida enquanto a duplicata ainda aguarda processamento.
    if (pendingPath.current === currentPath) return;
    const id = (requestId.current += 1);
    pendingPath.current = currentPath;
    fetcherRef.current(currentPath).then((data) => {
      if (requestId.current === id) setResult({ path: currentPath, status: 'success', data });
    }).catch((error: unknown) => {
      if (requestId.current === id) setResult({ path: currentPath, status: 'error', error });
    }).finally(() => {
      if (requestId.current === id) pendingPath.current = null;
    });
  }, []);

  useEffect(() => {
    if (path === null) return;
    load(path);
  }, [load, path]);

  const reload = useCallback(() => {
    if (path === null) return;
    // Não limpa `result` aqui: mantém os dados antigos visíveis até a nova resposta chegar
    // (stale-while-revalidate), em vez de forçar `status:'loading'` a cada reload. Um bug real
    // foi encontrado via E2E sem isso: cada `reload()` pós-mutação (ex.: adicionar membro)
    // desmontava a página inteira (Loading) e remontava — apagando o texto que o usuário
    // tivesse acabado de digitar em outro formulário da mesma tela antes da resposta chegar.
    // Loading só deve aparecer na carga inicial ou quando `path` muda para outro recurso
    // (ver `state` derivado abaixo, que compara `result.path` com `path`).
    load(path);
  }, [load, path]);

  // Atualização local otimista pós-mutação (ex.: arquivar, trocar capa) sem round-trip de
  // rede — preserva o comportamento que as páginas já tinham com `setData((current) => ...)`.
  const mutate = useCallback((updater: (data: T) => T) => {
    setResult((current) => (current && current.status === 'success' ? { ...current, data: updater(current.data) } : current));
  }, []);

  const state: ResourceState<T> = !result || result.path !== path
    ? { status: 'loading' }
    : result.status === 'success'
      ? { status: 'success', data: result.data }
      : { status: 'error', error: result.error };

  return { ...state, reload, mutate };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ClientApiError && error.status === 404;
}
export function isForbidden(error: unknown): boolean {
  return error instanceof ClientApiError && error.status === 403;
}
