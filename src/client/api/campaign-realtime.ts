import { useEffect, useRef, useState } from "react";
import type {
  VttRealtimeClientMessage,
  VttRealtimeServerMessage,
} from "../../domain/vtt-realtime";

// F-031/BATCH23 (Seção 8 do pedido de finalização — "não duplicar sockets desnecessariamente"):
// canal WebSocket ÚNICO por Campaign (GM ou Player — o servidor resolve o papel a partir da
// sessão, nunca o client), GET /api/v1/vtt/:campaignId/realtime. Reaproveitado por qualquer
// página que precise de atualização em tempo real da mesa (VttLivePage, PlayerCampaignHomePage)
// — nunca um segundo protocolo/hook divergente. PING/PONG/RESYNC_REQUIRED e a proteção contra
// STATE atrasado (sequência) são resolvidos AQUI DENTRO (preocupação de transporte); só
// mensagens STATE já validadas chegam ao consumidor via onState.
const WS_RECONNECT_DELAY_MS = 5000;
const WS_PING_INTERVAL_MS = 25000;

export interface UseCampaignRealtimeResult {
  connected: boolean;
}

type StateMessage = Extract<VttRealtimeServerMessage, { type: "STATE" }>;

export function useCampaignRealtime(
  campaignId: string | null | undefined,
  onState: (message: StateMessage) => void,
): UseCampaignRealtimeResult {
  const [connected, setConnected] = useState(false);
  const sequenceRef = useRef(0);
  // Mantém a closure mais recente do callback sem recriar a conexão a cada render do
  // consumidor (mesmo princípio de fetcherRef em use-resource.ts).
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    if (!campaignId) return;
    let stopped = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    const clearTimers = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };
    const send = (message: VttRealtimeClientMessage) => {
      try {
        ws?.send(JSON.stringify(message));
      } catch {
        /* socket já pode ter caído — próximo onclose reconecta */
      }
    };
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/v1/vtt/${campaignId}/realtime`);
      ws = socket;
      socket.addEventListener("open", () => {
        setConnected(true);
        pingTimer = setInterval(() => send({ type: "PING" }), WS_PING_INTERVAL_MS);
        // Pede o snapshot ativamente em vez de confiar só no HELLO/STATE que o servidor envia
        // sem ser solicitado — cobre qualquer rede que perca a primeira mensagem entre o
        // upgrade e o client terminar de se inscrever nos listeners.
        send({ type: "RESYNC" });
      });
      socket.addEventListener("message", (event) => {
        let message: VttRealtimeServerMessage;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "HELLO") {
          sequenceRef.current = message.sequence;
          return;
        }
        if (message.type === "STATE") {
          // Sequência atrasada (rede fora de ordem): nunca entrega um estado mais velho do que
          // o já aplicado — mesma proteção contra "stale client" do F-031.
          if (message.sequence < sequenceRef.current) return;
          sequenceRef.current = message.sequence;
          onStateRef.current(message);
          return;
        }
        if (message.type === "RESYNC_REQUIRED") send({ type: "RESYNC" });
      });
      const onDown = () => {
        setConnected(false);
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!stopped) reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
      };
      socket.addEventListener("close", onDown);
      socket.addEventListener("error", onDown);
    };
    // Adia a conexão inicial em vez de abrir sincronamente: o React StrictMode (dev only)
    // monta→desmonta→remonta o efeito na mesma tick — sem o adiamento, a PRIMEIRA conexão
    // (descartável) chega a ser aberta e fechada no meio do handshake antes do `stopped=true`
    // do StrictMode conseguir cancelá-la a tempo. Adiando, o cancelamento sempre chega primeiro.
    const initialConnectTimer = setTimeout(connect, 0);
    return () => {
      stopped = true;
      clearTimeout(initialConnectTimer);
      clearTimers();
      ws?.close();
    };
  }, [campaignId]);

  return { connected };
}
