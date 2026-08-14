import { Download, FileJson, FileSpreadsheet, Info, Monitor, Moon, Palette, Sun, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, deleteApi, patchJson, postJson } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { PageHeader } from "./dashboard-page";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemePreference } from "../theme/theme";

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
      <div className="settings-grid">
        <section className="panel setting-card">
          <FileSpreadsheet />
          <h2>Importar catálogo</h2>
          <p>
            CSV exportado da aba “Catálogo de Livros”. Nada é gravado antes da
            confirmação.
          </p>
          <ImportForm kind="catalog" />
        </section>
        <section className="panel setting-card">
          <FileSpreadsheet />
          <h2>Importar campanhas</h2>
          <p>
            CSV exportado da aba “Campanhas”. Importe o catálogo primeiro.
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
function ImportForm({kind}:{kind:"catalog"|"campaigns"}) {
  type PreviewItem = {
    row?: number;
    title: string;
    classification?: "NOVO" | "ATUALIZACAO" | "IGNORADO" | "ERRO";
    message?: string;
    currentCoverUrl?: string | null;
    incomingCoverUrl?: string | null;
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
      setApprovedRows(kind === "catalog" ? result.items
        .filter((item) => item.row && (item.classification === "NOVO" || item.classification === "ATUALIZACAO"))
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
            {preview.summary.NOVO ?? 0} novos · {preview.summary.ATUALIZACAO ?? 0} atualizações · {preview.summary.IGNORADO ?? 0} ignorados · {preview.summary.ERRO ?? 0} erros
          </span> : null}
          {kind === "catalog" ? <div className="table-wrap"><table><thead><tr><th>Aprovar</th><th>Linha</th><th>Classificação</th><th>RPG</th><th>Resultado</th></tr></thead><tbody>
            {preview.items.map((item) => {
              const actionable = item.classification === "NOVO" || item.classification === "ATUALIZACAO";
              return <tr key={`${item.row}-${item.title}`}>
                <td><input type="checkbox" aria-label={`Aprovar linha ${item.row}`} disabled={!actionable} checked={Boolean(item.row && approvedRows.includes(item.row))} onChange={(event) => {
                  if (!item.row) return;
                  setApprovedRows((current) => event.target.checked ? [...current, item.row!] : current.filter((row) => row !== item.row));
                }} /></td>
                <td>{item.row}</td><td><span className="badge">{item.classification}</span></td><td>{item.title || "—"}</td><td>{item.message}</td>
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
