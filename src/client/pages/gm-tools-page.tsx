import { Dices, Pause, Play, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatTimerSeconds, rollDice, type RollResult } from "../../domain/tools/dice";
import { PageHeader } from "./dashboard-page";

// F-004 (GM Tools): dice roller + timer, 100% client-side (sem backend, sem persistência —
// "Não criar backend sem necessidade"). "Quick note" já está satisfeito pelo F-005 (botão
// "Nova ideia" do Dashboard, que grava no Diário existente) — não duplicado aqui.

function DiceRoller() {
  const [notation, setNotation] = useState("1d20");
  const [history, setHistory] = useState<Array<RollResult & { id: number }>>([]);
  const [error, setError] = useState("");

  const roll = (event: FormEvent) => {
    event.preventDefault();
    const result = rollDice(notation);
    if (!result) { setError("Use o formato NdM ou NdM+K (ex.: 2d6+3), N até 20 e M até 1000."); return; }
    setError("");
    setHistory((current) => [{ ...result, id: Date.now() }, ...current].slice(0, 20));
  };

  return (
    <section className="panel gm-tool-card">
      <h2><Dices size={19}/>Rolador de dados</h2>
      <form className="compact-form" onSubmit={roll}>
        <label>Notação<input value={notation} onChange={(event) => setNotation(event.target.value)} placeholder="ex.: 2d6+3" maxLength={12}/></label>
        <button className="primary-button">Rolar</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {history.length > 0 && (
        <ul className="clean-list dice-history">
          {history.map((entry) => (
            <li key={entry.id}>
              <span><strong>{entry.notation}</strong><small>{entry.rolls.join(" + ")}{entry.modifier ? ` ${entry.modifier > 0 ? "+" : ""}${entry.modifier}` : ""}</small></span>
              <strong className="dice-total">{entry.total}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionTimer() {
  const [minutesInput, setMinutesInput] = useState("5");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = window.setInterval(() => setRemaining((current) => (current === null ? current : current - 1)), 1000);
    return () => window.clearInterval(intervalRef.current);
  }, [running]);

  const start = () => {
    if (remaining === null) {
      const minutes = Math.max(1, Math.min(180, Number(minutesInput) || 5));
      setRemaining(minutes * 60);
    }
    setRunning(true);
  };
  const pause = () => setRunning(false);
  const reset = () => { setRunning(false); setRemaining(null); };

  return (
    <section className="panel gm-tool-card">
      <h2><TimerIcon size={19}/>Timer de mesa</h2>
      <p className="section-note">Cronômetro simples — turnos, pausas, limite de cena. Não é salvo entre recarregamentos.</p>
      <div className="timer-display" role="timer" aria-live="polite">{remaining === null ? "--:--" : formatTimerSeconds(remaining)}</div>
      <div className="compact-form">
        <label>Minutos<input type="number" min={1} max={180} value={minutesInput} disabled={remaining !== null} onChange={(event) => setMinutesInput(event.target.value)}/></label>
        <div className="button-row">
          {!running ? <button type="button" className="primary-button" onClick={start}><Play size={17}/>{remaining === null ? "Iniciar" : "Continuar"}</button>
            : <button type="button" className="secondary-button" onClick={pause}><Pause size={17}/>Pausar</button>}
          <button type="button" className="ghost-button" onClick={reset}><RotateCcw size={17}/>Zerar</button>
        </div>
      </div>
    </section>
  );
}

export function GmToolsPage() {
  return (
    <div className="page">
      <PageHeader eyebrow="Ferramentas do Mestre" title="Prepare a mesa" description="Rolador de dados e timer — tudo local, nada é salvo no servidor. Para anotações rápidas, use “Nova ideia” no Painel."/>
      <div className="gm-tools-grid">
        <DiceRoller/>
        <SessionTimer/>
      </div>
    </div>
  );
}
