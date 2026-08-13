import { Download, FileJson, FileSpreadsheet, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, deleteApi, patchJson, postJson } from "../api/client";
import { useAuth } from "../auth/auth-context";
import { PageHeader } from "./dashboard-page";

function download(path: string) {
  window.location.assign(`/api/v1${path}`);
}
export function SettingsPage() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Configurações"
        title="Dados e portabilidade"
        description="Importe a planilha com prévia ou leve uma cópia completa dos seus dados."
      />
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
      </div>
    </div>
  );
}
function ImportForm({kind}:{kind:"catalog"|"campaigns"}) {
  const [preview, setPreview] = useState<{
    jobId: string;
    count: number;
    issues: Array<{ row: number; message: string }>;
    canConfirm: boolean;
    items: Array<{ title: string }>;
  }>();
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
      setPreview(await postJson(previewPath, { csv: await file.text() }));
    } catch (reason) {
      setMessage(reason instanceof Error?reason.message:"Falha inesperada.");
    }
  };
  const confirmImport = async () => {
    if (!preview) return;
    const result = await postJson<{ imported: number; skipped: number }>(
      kind==="catalog"?"/import/confirm":"/import/campaigns/confirm",
      { jobId: preview.jobId },
    );
    setMessage(
      `${result.imported} registros importados; ${result.skipped} duplicados ignorados.`,
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
          <strong>{preview.count} registros válidos</strong>
          {preview.items.map((item) => (
            <span key={item.title}>{item.title}</span>
          ))}
          {preview.issues.map((issue) => (
            <p className="form-error" key={`${issue.row}-${issue.message}`}>
              Linha {issue.row}: {issue.message}
            </p>
          ))}
          <button
            className="primary-button"
            disabled={!preview.canConfirm}
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
