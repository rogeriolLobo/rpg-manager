import { Download, FileJson, FileSpreadsheet, Info, Monitor, Moon, Palette, Sun, Trash2, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, deleteApi, patchJson, postJson } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { PageHeader } from "./dashboard-page";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemePreference } from "../theme/theme";
import { SUPPORTED_BACKUP_SCHEMA_VERSION } from "../../domain/backup/types";

function download(path: string) {
  window.location.assign(`/api/v1${path}`);
}
export function SettingsPage() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Configurações"
        title="Aparência, dados e portabilidade"
        description="Escolha como a biblioteca aparece, importe sua planilha ou leve uma cópia dos seus dados."
      />
      <AppearanceSettings />
      <PrivacySocialSettings />
      <div className="settings-grid">
        <section className="panel setting-card">
          <FileSpreadsheet />
          <h2>Importar catálogo</h2>
          {/* LIB-007: texto anterior dizia "CSV exportado da aba Catálogo de Livros", mas o CSV
              gerado por "Exportar meus dados" usa colunas em inglês (title, category, ...) —
              formato diferente do exigido aqui (Sistema / Jogo, Categoria, ...). Corrigido para
              descrever o formato realmente aceito, sem prometer um round-trip que não existe. */}
          <p>
            Planilha CSV com as colunas Sistema / Jogo, Categoria, Subgênero e
            Status da leitura (ISBN e capa são opcionais). Nada é gravado
            antes da confirmação.
          </p>
          <ImportForm kind="catalog" />
        </section>
        <section className="panel setting-card">
          <FileSpreadsheet />
          <h2>Importar campanhas</h2>
          <p>
            Planilha CSV com as colunas Campanha, RPG / Sistema e Status.
            Importe o catálogo primeiro — a campanha é vinculada pelo título
            do RPG.
          </p>
          <ImportForm kind="campaigns" />
        </section>
        <section className="panel setting-card">
          <FileJson />
          <h2>Exportar meus dados</h2>
          <p>Backup JSON completo ou catálogo CSV para portabilidade.</p>
          <button
            className="secondary-button"
            onClick={() => download("/export?format=json")}
          >
            <Download size={17} />
            Baixar JSON
          </button>
          <button
            className="secondary-button"
            onClick={() => download("/export?format=csv")}
          >
            <Download size={17} />
            Baixar CSV
          </button>
        </section>
        <section className="panel setting-card">
          <FileJson />
          <h2>Restaurar backup</h2>
          <p>
            Envie um backup JSON completo (v{SUPPORTED_BACKUP_SCHEMA_VERSION}) para restaurar
            Worlds, Vault e Diário. Sempre cria registros novos — nunca sobrescreve nem apaga
            dados existentes. Revise a prévia antes de confirmar.
          </p>
          <BackupRestoreForm />
        </section>
        <AboutSettings />
      </div>
    </div>
  );
}

function AboutSettings() {
  const [info, setInfo] = useState<{ commit: string; build: string }>();
  useEffect(() => {
    void api<{ commit: string; build: string }>("/version").then(setInfo);
  }, []);
  return (
    <section className="panel setting-card">
      <Info />
      <h2>Sobre</h2>
      <p>RPG Manager · Versão 1.0.0</p>
      {info && (
        <p className="section-note">
          Build {info.commit}
          {info.build !== "unknown" && ` · ${new Date(info.build).toLocaleString("pt-BR")}`}
        </p>
      )}
    </section>
  );
}

const themeOptions: Array<{ value:ThemePreference; label:string; description:string; icon:typeof Sun }> = [
  { value:'LIGHT', label:'Claro', description:'Papel, creme e vinho para leitura durante o dia.', icon:Sun },
  { value:'DARK', label:'Escuro', description:'Uma biblioteca quente e sombria para a noite.', icon:Moon },
  { value:'SYSTEM', label:'Sistema', description:'Acompanha automaticamente o tema do dispositivo.', icon:Monitor },
];

function AppearanceSettings() {
  const { preference, resolvedTheme, saving, setPreference } = useTheme();
  const [error, setError] = useState('');
  const changeTheme = async (nextPreference:ThemePreference) => {
    setError('');
    try { await setPreference(nextPreference); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o tema.'); }
  };
  return <section className="panel appearance-settings" aria-labelledby="appearance-heading">
    <div className="section-heading"><div><Palette/><h2 id="appearance-heading">Aparência</h2><p className="section-note">A preferência fica nesta conta e também é aplicada antes da tela carregar.</p></div><span className="theme-resolution">Tema atual: {resolvedTheme === 'dark' ? 'escuro' : 'claro'}</span></div>
    <fieldset className="theme-selector" disabled={saving}>
      <legend>Tema</legend>
      {themeOptions.map(({value,label,description,icon:Icon})=><label className={`theme-option ${preference===value?'selected':''}`} key={value}>
        <input type="radio" name="theme" value={value} checked={preference===value} onChange={()=>void changeTheme(value)}/>
        <Icon aria-hidden="true"/>
        <span><strong>{label}</strong><small>{description}</small></span>
      </label>)}
    </fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}
  </section>;
}
// F-017 (BATCH8): opt-in explícito — desligado por padrão, ninguém vê a Biblioteca de
// outra conta sem essa ação consciente do dono. Nunca expõe notas/prioridade/grupo/
// mestre/data planejada nem o campo pessoal "Quero jogar" — só o que já é seguro
// mostrar a amigos (ver src/server/routes/social.ts).
function PrivacySocialSettings() {
  const [visible, setVisible] = useState<boolean>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ libraryVisibleToFriends: boolean }>("/preferences/library-visibility")
      .then((result) => { if (active) setVisible(result.libraryVisibleToFriends); })
      .catch(() => { if (active) setVisible(false); });
    return () => { active = false; };
  }, []);
  const toggle = async (next: boolean) => {
    setError("");
    setVisible(next);
    try {
      await patchJson("/preferences/library-visibility", { libraryVisibleToFriends: next });
    } catch (reason) {
      setVisible(!next);
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar esta preferência.");
    }
  };
  return (
    <section className="panel privacy-social-settings" aria-labelledby="privacy-social-heading">
      <div className="section-heading">
        <div>
          <Users />
          <h2 id="privacy-social-heading">Privacidade social</h2>
          <p className="section-note">
            Controla o que seus amigos podem ver. Notas, prioridade, grupo, mestre e
            data planejada nunca são compartilhados, mesmo com esta opção ligada.
          </p>
        </div>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={Boolean(visible)} disabled={visible === undefined} onChange={(event) => void toggle(event.target.checked)} />
        Compartilhar minha Biblioteca com amigos
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
function ImportForm({kind}:{kind:"catalog"|"campaigns"}) {
  type PreviewItem = {
    row?: number;
    title: string;
    classification?: "NOVO" | "ATUALIZACAO" | "IGNORADO" | "ERRO" | "EXISTING_PUBLICATION" | "ALREADY_IN_LIBRARY" | "ARCHIVED_IN_LIBRARY";
    message?: string;
    currentCoverUrl?: string | null;
    incomingCoverUrl?: string | null;
    // LIB-003/LIB-006: ID da Library Entry existente (ALREADY_IN_LIBRARY/ARCHIVED_IN_LIBRARY) —
    // usado só para linkar; nunca reenviado ao /import/confirm.
    existingId?: string | null;
  };
  const [preview, setPreview] = useState<{
    jobId: string;
    count: number;
    issues: Array<{ row: number; message: string }>;
    canConfirm: boolean;
    items: PreviewItem[];
    summary?: Record<string, number>;
  }>();
  const [approvedRows, setApprovedRows] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    const input = event.currentTarget.elements.namedItem(
      "csv",
    ) as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const previewPath=kind==="catalog"?"/import/preview":"/import/campaigns/preview";
      const result = await postJson<NonNullable<typeof preview>>(previewPath, { csv: await file.text() });
      setPreview(result);
      // LIB-007: EXISTING_PUBLICATION já era aprovável/processável pelo backend desde LIB-003
      // (reaproveita a Publication existente, cria só a User Library Entry — ver
      // buildCreateLibraryEntryStatements) mas nunca era tratado como "actionable" aqui: a
      // linha ficava sempre com o checkbox desabilitado e nunca pré-selecionada. Mesmo critério
      // de segurança/aditividade de NOVO/ATUALIZACAO — sem risco de duplicar.
      setApprovedRows(kind === "catalog" ? result.items
        .filter((item) => item.row && (item.classification === "NOVO" || item.classification === "ATUALIZACAO" || item.classification === "EXISTING_PUBLICATION"))
        .map((item) => item.row!) : []);
    } catch (reason) {
      setMessage(reason instanceof Error?reason.message:"Falha inesperada.");
    }
  };
  const confirmImport = async () => {
    if (!preview) return;
    const result = await postJson<{ imported: number; updated?: number; skipped: number }>(
      kind==="catalog"?"/import/confirm":"/import/campaigns/confirm",
      kind === "catalog" ? { jobId: preview.jobId, approvedRows } : { jobId: preview.jobId },
    );
    setMessage(
      kind === "catalog"
        ? `${result.imported} novos; ${result.updated ?? 0} capas atualizadas; ${result.skipped} linhas sem alteração.`
        : `${result.imported} registros importados; ${result.skipped} duplicados ignorados.`,
    );
    setPreview(undefined);
  };
  return (
    <>
      <form onSubmit={submit}>
        <label>
          Arquivo CSV
          <input name="csv" type="file" accept=".csv,text/csv" required />
        </label>
        <button className="primary-button">Gerar prévia</button>
      </form>
      {preview && (
        <div className="import-preview">
          <strong>{preview.count} linhas analisadas</strong>
          {kind === "catalog" && preview.summary ? <span>
            {preview.summary.NOVO ?? 0} novos · {preview.summary.ATUALIZACAO ?? 0} atualizações
            {(preview.summary.EXISTING_PUBLICATION ?? 0) > 0 ? ` · ${preview.summary.EXISTING_PUBLICATION} já no catálogo` : ""}
            {' · '}{preview.summary.IGNORADO ?? 0} ignorados · {preview.summary.ERRO ?? 0} erros
            {(preview.summary.ALREADY_IN_LIBRARY ?? 0) > 0 ? ` · ${preview.summary.ALREADY_IN_LIBRARY} já na biblioteca` : ""}
            {(preview.summary.ARCHIVED_IN_LIBRARY ?? 0) > 0 ? ` · ${preview.summary.ARCHIVED_IN_LIBRARY} arquivados` : ""}
          </span> : null}
          {kind === "catalog" ? <div className="table-wrap"><table><thead><tr><th>Aprovar</th><th>Linha</th><th>Classificação</th><th>RPG</th><th>Resultado</th></tr></thead><tbody>
            {preview.items.map((item) => {
              const actionable = item.classification === "NOVO" || item.classification === "ATUALIZACAO" || item.classification === "EXISTING_PUBLICATION";
              return <tr key={`${item.row}-${item.title}`}>
                <td><input type="checkbox" aria-label={`Aprovar linha ${item.row}`} disabled={!actionable} checked={Boolean(item.row && approvedRows.includes(item.row))} onChange={(event) => {
                  if (!item.row) return;
                  setApprovedRows((current) => event.target.checked ? [...current, item.row!] : current.filter((row) => row !== item.row));
                }} /></td>
                <td>{item.row}</td><td><span className="badge">{item.classification}</span></td><td>{item.title || "—"}</td>
                <td>{item.message}{item.existingId && <Link to={`/app/library/${item.existingId}`}> Abrir</Link>}</td>
              </tr>;
            })}
          </tbody></table></div> : preview.items.map((item) => <span key={item.title}>{item.title}</span>)}
          {preview.issues.map((issue) => (
            <p className="form-error" key={`${issue.row}-${issue.message}`}>
              Linha {issue.row}: {issue.message}
            </p>
          ))}
          <button
            className="primary-button"
            disabled={!preview.canConfirm || (kind === "catalog" && approvedRows.length === 0)}
            onClick={() => void confirmImport()}
          >
            Confirmar importação
          </button>
        </div>
      )}
      {message && <p className="success-message">{message}</p>}
    </>
  );
}

// F-015: mesmo padrão de preview/confirm do ImportForm acima — nada é gravado antes da
// confirmação explícita, e a prévia sempre mostra contagem + avisos por domínio (ex.: "RPG
// padrão não encontrado", "jogador vinculado não existe mais") para que a decisão de confirmar
// seja informada, não um clique cego.
function BackupRestoreForm() {
  const [preview, setPreview] = useState<{
    jobId: string;
    summary: Record<string, number>;
    warnings: Array<{ domain: string; oldId: string; message: string }>;
    canConfirm: boolean;
  }>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(""); setMessage("");
    const input = event.currentTarget.elements.namedItem("backup") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await postJson<NonNullable<typeof preview>>("/import/backup/preview", { backup: await file.text() });
      setPreview(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ler este backup.");
    } finally {
      setBusy(false);
    }
  };
  const confirmRestore = async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const result = await postJson<{ restored: Record<string, number> }>("/import/backup/confirm", { jobId: preview.jobId });
      const parts = Object.entries(result.restored).filter(([, count]) => count > 0).map(([domain, count]) => `${count} ${domain}`);
      setMessage(parts.length ? `Restaurado: ${parts.join(", ")}.` : "Nada precisou ser restaurado.");
      setPreview(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível restaurar este backup.");
    } finally {
      setBusy(false);
    }
  };
  const summaryLabels: Record<string, string> = { worlds: "Worlds", creatureStatTemplates: "Modelos de ficha", entities: "Entidades do Vault", journalFolders: "Pastas do Diário", journalPages: "Páginas do Diário", worldEntityLinks: "Vínculos entre Worlds" };
  return (
    <>
      <form onSubmit={submit}>
        <label>
          Arquivo de backup (.json)
          <input name="backup" type="file" accept=".json,application/json" required />
        </label>
        <button className="primary-button" disabled={busy}>Gerar prévia</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {preview && (
        <div className="import-preview">
          <strong>Prévia do restore</strong>
          <ul className="clean-list">
            {Object.entries(preview.summary).filter(([, count]) => count > 0).map(([domain, count]) => (
              <li key={domain}>{summaryLabels[domain] ?? domain}: {count}</li>
            ))}
          </ul>
          {preview.warnings.length > 0 && (
            <>
              <p className="section-note">{preview.warnings.length} aviso(s) — referências que não puderam ser preservadas continuam documentadas, o restante é restaurado normalmente:</p>
              {preview.warnings.map((warning, index) => (
                <p className="form-error" key={`${warning.domain}-${warning.oldId}-${index}`}>{warning.message}</p>
              ))}
            </>
          )}
          <button className="primary-button" disabled={!preview.canConfirm || busy} onClick={() => void confirmRestore()}>
            Confirmar restore
          </button>
        </div>
      )}
      {message && <p className="success-message">{message}</p>}
    </>
  );
}

interface ActiveSession {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  current: boolean;
}
export function SecurityPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [message, setMessage] = useState("");
  const load = () =>
    api<{ sessions: ActiveSession[] }>("/auth/sessions").then((result) =>
      setSessions(result.sessions),
    );
  useEffect(() => {
    void api<{ sessions: ActiveSession[] }>("/auth/sessions").then((result) =>
      setSessions(result.sessions),
    );
  }, []);
  const change = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await postJson("/auth/change-password", {
      currentPassword: data.get("currentPassword"),
      newPassword: data.get("newPassword"),
      revokeOtherSessions: data.get("revokeOthers") === "on",
    });
    event.currentTarget.reset();
    setMessage("Senha alterada e sessão atual rotacionada.");
    await load();
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Segurança"
        title="Sessões e credenciais"
        description="Revogue acessos, altere a senha ou encerre todas as sessões."
      />
      <div className="dashboard-grid">
        <section className="panel">
          <h2>Sessões ativas</h2>
          <ul className="session-security-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>
                    {session.current ? "Este dispositivo" : "Outro dispositivo"}
                  </strong>
                  <small>
                    {session.user_agent || "Navegador não identificado"}
                  </small>
                  <span>
                    Expira em{" "}
                    {new Intl.DateTimeFormat("pt-BR").format(
                      new Date(session.expires_at),
                    )}
                  </span>
                </div>
                <button
                  className="ghost-button"
                  onClick={async () => {
                    await deleteApi(`/auth/sessions/${session.id}`);
                    if (session.current) {
                      setUser(null);
                      navigate("/login");
                    } else await load();
                  }}
                >
                  Revogar
                </button>
              </li>
            ))}
          </ul>
          <button
            className="danger-button"
            onClick={async () => {
              await postJson("/auth/logout-all", {});
              setUser(null);
              navigate("/login");
            }}
          >
            Encerrar todas as sessões
          </button>
        </section>
        <section className="panel">
          <h2>Alterar senha</h2>
          <form onSubmit={change}>
            <label>
              Senha atual
              <input name="currentPassword" type="password" required />
            </label>
            <label>
              Nova senha
              <input
                name="newPassword"
                type="password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <label className="checkbox">
              <input name="revokeOthers" type="checkbox" defaultChecked />
              Encerrar as outras sessões
            </label>
            <button className="primary-button">Alterar senha</button>
          </form>
          {message && <p className="success-message">{message}</p>}
        </section>
      </div>
      <section className="panel danger-zone">
        <Trash2 />
        <div>
          <h2>Excluir conta</h2>
          <p>
            Remove permanentemente biblioteca, campanhas, membros e sessões.
          </p>
        </div>
        <DeleteAccount />
      </section>
    </div>
  );
}
function DeleteAccount() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirm("Esta ação é permanente. Continuar?")) return;
    const data = new FormData(event.currentTarget);
    await deleteApi("/auth/account", {
      currentPassword: data.get("password"),
      confirmation: data.get("confirmation"),
    });
    setUser(null);
    navigate("/");
  };
  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        name="password"
        type="password"
        placeholder="Senha atual"
        aria-label="Senha atual"
        required
      />
      <input
        name="confirmation"
        placeholder="EXCLUIR MINHA CONTA"
        aria-label="Confirmação"
        required
      />
      <button className="danger-button">Excluir conta</button>
    </form>
  );
}

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await patchJson<{ user: NonNullable<typeof user> }>(
      "/profile",
      { displayName: data.get("displayName") },
    );
    setUser(result.user);
    setMessage("Perfil atualizado.");
  };
  return (
    <div className="page narrow">
      <PageHeader
        eyebrow="Perfil"
        title="Sua identidade na estante"
        description="Armazenamos somente o necessário para operar sua conta."
      />
      <section className="panel">
        <form onSubmit={submit}>
          <label>
            Nome de exibição
            <input
              name="displayName"
              defaultValue={user?.displayName}
              maxLength={80}
              required
            />
          </label>
          <label>
            E-mail
            <input value={user?.email ?? ""} disabled />
            <small>
              A alteração de e-mail não está disponível na V1 sem infraestrutura
              de verificação.
            </small>
          </label>
          <button className="primary-button">Salvar perfil</button>
        </form>
        {message && <p className="success-message">{message}</p>}
      </section>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <main className="legal-page">
      <span className="eyebrow">RPG Manager</span>
      <h1>Privacidade</h1>
      <p>
        Armazenamos e-mail, nome de exibição, credenciais protegidas, sessões e
        os dados de RPG que você cadastra. Esses dados são usados exclusivamente
        para autenticar sua conta e oferecer biblioteca, campanhas, sessões,
        importação e backup.
      </p>
      <h2>Segurança</h2>
      <p>
        Senhas são derivadas com função lenta e salt único. Tokens de sessão e
        códigos de recuperação não são armazenados em formato utilizável. Logs
        não incluem senhas, tokens ou corpos sensíveis.
      </p>
      <h2>Seus controles</h2>
      <p>
        Em Configurações você pode exportar seus dados em JSON ou CSV. Em
        Segurança você pode revogar sessões e excluir permanentemente a conta e
        seus dados relacionados.
      </p>
      <h2>Infraestrutura</h2>
      <p>
        A aplicação utiliza Cloudflare Workers e D1. Não usa a Google Sheets
        como banco de produção e não vende dados pessoais.
      </p>
    </main>
  );
}
