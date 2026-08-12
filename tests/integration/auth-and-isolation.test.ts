import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/server/types";

const worker = exports as unknown as {
  default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
};
const origin = "https://example.com";
const testEnv = env as unknown as Env;
let requestSequence = 1;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookies?: string,
  csrf?: string,
) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      "CF-Connecting-IP": `192.0.2.${requestSequence++ % 250}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { Origin: origin } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function authCookies(response: Response) {
  const value = response.headers.get("set-cookie") ?? "";
  const session = value.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = value.match(/rpg_csrf=([^;,]+)/)?.[1];
  if (!session || !csrf) throw new Error(`Cookies ausentes: ${value}`);
  return { cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}
async function register(email: string) {
  const response = await request("/auth/register", "POST", {
    email,
    displayName: email.split("@")[0],
    password: "esta e uma senha longa 2026",
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { recoveryCodes: string[] };
  return { ...authCookies(response), recoveryCodes: body.recoveryCodes };
}
const rpg = {
  title: "Blue Rose",
  categoryId: "fantasia",
  subgenreId: "alta-fantasia",
  readingStatus: "READING",
  hasPlayed: false,
  wantsToPlay: true,
  priority: "HIGH",
  playGroupNotes: "Grupo",
  plannedPlayDate: null,
  tableStatus: "IDEA",
  gameMaster: "Rogério",
  notes: "<script>alert(1)</script>",
  coverUrl: null,
};
const campaign = {
  name: "A Coroa Azul",
  status: "PREPARING",
  gameMaster: "Rogério",
  sessionZeroDate: null,
  firstSessionDate: null,
  frequency: "BIWEEKLY",
  nextSessionDate: null,
  sessionGoal: 12,
  legacyMembersText: "",
  notes: "Campanha isolada por proprietário.",
};
describe("API real com D1", () => {
  it("registra, autentica, persiste hash e recupera com código de uso único", async () => {
    const account = await register("auth@example.com");
    const session = await request(
      "/auth/session",
      "GET",
      undefined,
      account.cookie,
    );
    expect(session.status).toBe(200);
    const recovery = await request("/auth/recover", "POST", {
      email: "auth@example.com",
      recoveryCode: account.recoveryCodes[0],
      newPassword: "uma nova senha longa 2026",
    });
    expect(recovery.status).toBe(200);
    expect(
      (await request("/auth/session", "GET", undefined, account.cookie)).status,
    ).toBe(401);
    const reused = await request("/auth/recover", "POST", {
      email: "auth@example.com",
      recoveryCode: account.recoveryCodes[0],
      newPassword: "outra senha longa 2026",
    });
    expect(reused.status).toBe(401);
  });
  it("faz login, logout e rotação integral ao trocar a senha", async () => {
    const account = await register("rotation@example.com");
    const logout = await request(
      "/auth/logout",
      "POST",
      {},
      account.cookie,
      account.csrf,
    );
    expect(logout.status).toBe(200);
    expect(
      (await request("/auth/session", "GET", undefined, account.cookie)).status,
    ).toBe(401);

    const login = await request("/auth/login", "POST", {
      email: "rotation@example.com",
      password: "esta e uma senha longa 2026",
    });
    expect(login.status).toBe(200);
    const current = authCookies(login);
    const changed = await request(
      "/auth/change-password",
      "POST",
      {
        currentPassword: "esta e uma senha longa 2026",
        newPassword: "senha substituta ainda longa 2026",
        revokeOtherSessions: true,
      },
      current.cookie,
      current.csrf,
    );
    expect(changed.status).toBe(200);
    const replacement = authCookies(changed);
    expect(replacement.cookie).not.toBe(current.cookie);
    expect(
      (await request("/auth/session", "GET", undefined, current.cookie)).status,
    ).toBe(401);
    expect(
      (await request("/auth/session", "GET", undefined, replacement.cookie))
        .status,
    ).toBe(200);
    expect(
      (
        await request("/auth/login", "POST", {
          email: "rotation@example.com",
          password: "esta e uma senha longa 2026",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/auth/login", "POST", {
          email: "rotation@example.com",
          password: "senha substituta ainda longa 2026",
        })
      ).status,
    ).toBe(200);
  });
  it("rejeita sessão expirada no armazenamento server-side", async () => {
    const account = await register("expired@example.com");
    await testEnv.DB.prepare(
      "UPDATE auth_sessions SET expires_at=? WHERE revoked_at IS NULL",
    )
      .bind("2000-01-01T00:00:00.000Z")
      .run();
    expect(
      (await request("/auth/session", "GET", undefined, account.cookie)).status,
    ).toBe(401);
  });
  it("bloqueia CSRF e isolamento de User A/User B", async () => {
    const a = await register("a@example.com");
    const b = await register("b@example.com");
    const withoutCsrf = await request("/rpgs", "POST", rpg, a.cookie);
    expect(withoutCsrf.status).toBe(403);
    const created = await request("/rpgs", "POST", rpg, a.cookie, a.csrf);
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      item: { id: string; notes: string };
    };
    expect(body.item.notes).toBe("<script>alert(1)</script>");
    expect(
      (await request(`/rpgs/${body.item.id}`, "GET", undefined, b.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request(`/rpgs/${body.item.id}`, "PATCH", rpg, b.cookie, b.csrf))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/rpgs/${body.item.id}`,
          "DELETE",
          undefined,
          b.cookie,
          b.csrf,
        )
      ).status,
    ).toBe(404);
  });
  it("rejeita SQL injection, JSON malformado e campo de mass assignment", async () => {
    const a = await register("security@example.com");
    const injection = await request(
      `/rpgs?search=${encodeURIComponent("' OR 1=1 --")}`,
      "GET",
      undefined,
      a.cookie,
    );
    expect(injection.status).toBe(200);
    expect(
      ((await injection.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);
    const malformed = await worker.default.fetch(`${origin}/api/v1/rpgs`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: a.cookie,
        "X-CSRF-Token": a.csrf,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const mass = await request(
      "/rpgs",
      "POST",
      { ...rpg, userId: "victim" },
      a.cookie,
      a.csrf,
    );
    expect(mass.status).toBe(422);
  });
  it("isola campanhas e impede que B registre sessão na campanha de A", async () => {
    const a = await register("campaign-a@example.com");
    const b = await register("campaign-b@example.com");
    const createdRpg = await request("/rpgs", "POST", rpg, a.cookie, a.csrf);
    const rpgId = ((await createdRpg.json()) as { item: { id: string } }).item.id;
    const createdCampaign = await request(
      "/campaigns",
      "POST",
      { ...campaign, rpgId },
      a.cookie,
      a.csrf,
    );
    expect(createdCampaign.status).toBe(201);
    const campaignId = (
      (await createdCampaign.json()) as { item: { id: string } }
    ).item.id;
    const member = await request(
      `/campaigns/${campaignId}/members`,
      "POST",
      { playerName: "Adriana", characterName: "Lina", notes: "", active: true },
      a.cookie,
      a.csrf,
    );
    expect(member.status).toBe(201);
    const session = await request(
      `/campaigns/${campaignId}/sessions`,
      "POST",
      {
        title: "O chamado",
        playedAt: "2026-08-12",
        summary: "Resumo real do teste.",
        gmNotes: "",
        nextHooks: "A carta.",
        attendeeMemberIds: [],
      },
      a.cookie,
      a.csrf,
    );
    expect(session.status).toBe(201);
    const history = await request(
      `/campaigns/${campaignId}/sessions`,
      "GET",
      undefined,
      a.cookie,
    );
    expect(history.status).toBe(200);
    expect(((await history.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect(
      (
        await request(
          `/campaigns/${campaignId}`,
          "GET",
          undefined,
          b.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/campaigns/${campaignId}/sessions`,
          "POST",
          {
            title: "Sessão indevida",
            playedAt: "2026-08-12",
            summary: "",
            gmNotes: "",
            nextHooks: "",
            attendeeMemberIds: [],
          },
          b.cookie,
          b.csrf,
        )
      ).status,
    ).toBe(404);
  });
  it("rejeita payload excessivo e devolve cabeçalhos defensivos", async () => {
    const account = await register("headers@example.com");
    const oversized = await worker.default.fetch(`${origin}/api/v1/rpgs`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: account.cookie,
        "X-CSRF-Token": account.csrf,
        "Content-Type": "application/json",
        "Content-Length": "1000001",
      },
      body: "{}",
    });
    expect(oversized.status).toBe(413);
    const health = await request("/health");
    expect(health.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("strict-transport-security")).toContain(
      "max-age=31536000",
    );
  });
  it("aplica bloqueio progressivo por conta após falhas de login", async () => {
    await register("rate-limit@example.com");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await request("/auth/login", "POST", {
        email: "rate-limit@example.com",
        password: "senha errada mas com tamanho válido",
      });
      expect(failed.status).toBe(401);
    }
    const blocked = await request("/auth/login", "POST", {
      email: "rate-limit@example.com",
      password: "senha errada mas com tamanho válido",
    });
    expect(blocked.status).toBe(429);
  });
});
