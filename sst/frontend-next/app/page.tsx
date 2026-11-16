"use client";
import { useEffect, useRef, useState } from "react";
import {
  Heart,
  Brain,
  Bone,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  X,
  ClipboardList,
} from "lucide-react";
import CieSearch from "@/components/cie-search";
import Statistics from "@/components/charts/statistics";
import { Button } from "@/components/ui/button";
import { init, syncHistory, type IntranetClient } from "@intranet/sdk";
import pkg from "../package.json";
type Row = Record<string, any>;
type AuthIdentity = {
  source: "development" | "intranet";
  app?: string;
  expires_at?: string | null;
  usuario: {
    id: string;
    nombre: string;
    email_corporativo: string;
    [key: string]: unknown;
  };
  sdk_user?: { id: string; nombre: string; email_corporativo: string };
};
const isDevelopment = process.env.NODE_ENV === "development";
const modules = [
  { name: "Salud General", key: "salud_general", icon: Heart },
  { name: "Salud Mental", key: "salud_mental", icon: Brain },
  { name: "Osteomuscular", key: "osteomuscular", icon: Bone },
];
const catalogs = [
  "CaseTypes",
  "Categories",
  "States",
  "EntityTypes",
  "Entities",
  "ActionTypes",
  "AffectedSystems",
];
const label = (v: any): string =>
  typeof v === "object" && v
    ? v.Name ||
      v.Nombre ||
      v.Diagnostico ||
      v.Descripcion ||
      v.Codigo ||
      v.Code ||
      "—"
    : String(v ?? "—");
const normalize = (v: any) =>
  label(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const stateKey = (v: any) => {
  const key = normalize(v);
  return key === "enseguimiento" ? "seguimiento" : key;
};
const day = (v: any) => (v ? String(v).slice(0, 10) : "—");
const fk: Record<string, string> = {
  CaseTypeId: "CaseTypes",
  CategoryId: "Categories",
  StateId: "States",
  EntityTypeId: "EntityTypes",
  EntityId: "Entities",
  ActionTypeId: "ActionTypes",
  AffectedSystemId: "AffectedSystems",
};
const keyOf = (t: string) =>
  ({
    Categories: "CategoryId",
    Entities: "EntityId",
    CaseTypes: "CaseTypeId",
    States: "StateId",
    EntityTypes: "EntityTypeId",
    ActionTypes: "ActionTypeId",
    AffectedSystems: "AffectedSystemId",
  })[t] || "StrapiId";
function Avatar({
  person,
  size = "md",
}: {
  person?: Row;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const name = person?.Nombre || "Sin nombre";
  const dimensions =
    size === "lg"
      ? "h-14 w-14 text-lg"
      : size === "sm"
        ? "h-8 w-8 text-xs"
        : "h-10 w-10 text-sm";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0])
      .join("")
      .toUpperCase() || "?";
  return person?.Foto && !failed ? (
    <img
      src={person.Foto}
      alt={`Foto de ${name}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${dimensions} shrink-0 rounded-full border border-stone-200 bg-stone-100 object-cover`}
    />
  ) : (
    <span
      aria-label={`Sin foto de ${name}`}
      className={`${dimensions} grid shrink-0 place-items-center rounded-full border border-stone-200 bg-[#efe7e1] font-semibold text-[#674838]`}
    >
      {initials}
    </span>
  );
}
const roleName = (role?: string) =>
  ({
    colaborador: "Colaborador",
    creador: "Reportado por",
    creador_seguimiento: "Seguimiento realizado por",
  })[role || ""] ||
  role ||
  "Persona vinculada";
export default function Page() {
  const [token, setToken] = useState(""),
    [entry, setEntry] = useState(""),
    [ready, setReady] = useState(false),
    [module, setModule] = useState("salud_general"),
    [reports, setReports] = useState<Row[]>([]),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [search, setSearch] = useState(""),
    [state, setState] = useState(""),
    [city, setCity] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [mode, setMode] = useState<"report" | "action" | null>(null),
    [form, setForm] = useState<Row>({}),
    [page, setPage] = useState(1);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [authError, setAuthError] = useState("");
  const intranetRef = useRef<IntranetClient | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [cie, setCie] = useState<any>(null);
  const [extraFilters, setExtraFilters] = useState<Record<string, string>>({});
  const [dash, setDash] = useState<Row>({}),
    [collaborators, setCollaborators] = useState<Row[]>([]);
  const modal = useRef<HTMLDialogElement>(null);
  async function validateCredential(credential: string): Promise<AuthIdentity> {
    const response = await fetch("/backend/auth/me", {
      headers: { Authorization: `Bearer ${credential}` },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "No fue posible validar la sesión",
      );
    }
    return data;
  }
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    async function startAuthentication() {
      setAuthError("");
      if (isDevelopment) {
        const saved = sessionStorage.getItem("sst_token") || "";
        if (saved) {
          try {
            const verified = await validateCredential(saved);
            if (!disposed) {
              setIdentity(verified);
              setToken(saved);
            }
          } catch {
            sessionStorage.removeItem("sst_token");
          }
        }
        if (!disposed) setReady(true);
        return;
      }
      try {
        const intranet = await init({
          dependencies: pkg.dependencies,
          dev: false,
          captureErrors: true,
        });
        if (disposed) {
          intranet.destroy();
          return;
        }
        intranetRef.current = intranet;
        cleanups.push(syncHistory(intranet));
        const sdkUser = intranet.getUser();
        const receivedToken = await intranet.getToken();
        const verified = await validateCredential(receivedToken);
        if (!disposed) {
          setIdentity({ ...verified, sdk_user: sdkUser });
          setToken(receivedToken);
        }
        cleanups.push(
          intranet.onTokenChange(async ({ token: renewedToken }) => {
            try {
              const renewedIdentity = await validateCredential(renewedToken);
              if (!disposed) {
                setIdentity({ ...renewedIdentity, sdk_user: sdkUser });
                setToken(renewedToken);
              }
            } catch (error) {
              intranet.reportError(error);
            }
          }),
        );
        cleanups.push(
          intranet.onSessionLost(() => {
            if (!disposed) {
              setToken("");
              setIdentity(null);
              setAuthError("La sesión de la Intranet terminó.");
            }
          }),
        );
      } catch (error) {
        if (!disposed) {
          setAuthError(
            error instanceof Error
              ? error.message
              : "No fue posible conectar con la Intranet",
          );
        }
      } finally {
        if (!disposed) setReady(true);
      }
    }
    void startAuthentication();
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
      intranetRef.current?.destroy();
      intranetRef.current = null;
    };
  }, []);
  async function api(path: string, body?: Row, credential = token) {
    const res = await fetch("/backend/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${credential}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        if (isDevelopment) sessionStorage.removeItem("sst_token");
        setToken("");
        setIdentity(null);
      }
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : `No se pudo completar la solicitud (${res.status}).`,
      );
    }
    return data;
  }
  async function all(table: string, credential = token) {
    let result: Row[] = [];
    for (let offset = 0; ; offset += 100) {
      const part = await api(
        `api/${table}?limit=100&offset=${offset}`,
        undefined,
        credential,
      );
      result = result.concat(part);
      if (part.length < 100) return result;
    }
  }
  const requestVersion = useRef(0);
  const cache = useRef<Record<string, any>>({});
  async function load(force = false) {
    const version = ++requestVersion.current;
    setError("");
    setBusy(true);
    setReports([]);
    try {
      const data =
        (!force && cache.current[module]) ||
        (await api(`sgsst/${module}/workspace`));
      if (version !== requestVersion.current) return;
      cache.current[module] = data;
      setOptions(data.catalogs);
      setReports(data.reports);
      setCollaborators(
        data.reports.flatMap((r: Row) =>
          (r.ReportPeople || []).filter((p: Row) => p.Role === "colaborador"),
        ),
      );
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }
  async function view(r: Row) {
    try {
      setSelected(await api(`sgsst/${module}/reports/${r.StrapiId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (token) void load();
  }, [token, module]);
  useEffect(() => {
    if (mode) modal.current?.showModal();
    else modal.current?.close();
  }, [mode]);
  useEffect(() => {
    setPage(1);
  }, [module, search, state, city, extraFilters]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const verified = await validateCredential(entry);
      sessionStorage.setItem("sst_token", entry);
      setIdentity(verified);
      setToken(entry);
      setEntry("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = modules.find((m) => m.key === module)!;
  const base = reports.filter(
    (r) => module === "todos" || normalize(r.CaseTypeId) === normalize(module),
  );
  const people = (r: Row): Row[] => r.ReportPeople || [];
  const overdue = (r: Row) => {
    if (normalize(r.StateId) === "cerrado") return false;
    const a = [...(r.Actions || [])].sort(
      (a: Row, b: Row) => b.StrapiId - a.StrapiId,
    )[0];
    return (
      !!a?.Temporalidad &&
      day(a.Temporalidad) <
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(
          new Date(),
        )
    );
  };
  const filtered = base.filter(
    (r) =>
      Object.entries(extraFilters).every(
        ([k, v]) =>
          !v ||
          (k === "Sistema"
            ? r.Actions?.some((a: Row) => label(a.AffectedSystemId) === v)
            : people(r).some((p) => p[k] === v)),
      ) &&
      (!state ||
        (state === "vencido"
          ? overdue(r)
          : stateKey(r.StateId) === stateKey(state))) &&
      (!city || people(r).some((p) => p.Ciudad === city)) &&
      normalize(
        [
          r.StrapiId,
          r.Descripcion,
          ...people(r).flatMap((p) => [p.Nombre, p.Documento, p.Cargo]),
        ].join(" "),
      ).includes(normalize(search)),
  );
  const cities = Array.from(
    new Set(
      base.flatMap((r) =>
        people(r)
          .map((p) => p.Ciudad)
          .filter(Boolean),
      ),
    ),
  ).sort();
  function openForm(kind: "report" | "action") {
    setMode(kind);
    setError("");
    setCie(null);
    setEditId(null);
    setForm({
      FechaCreacionManual: new Date().toISOString().slice(0, 10),
      ...(kind === "report"
        ? {
            CaseTypeId: options.CaseTypes?.find(
              (c) => normalize(c) === normalize(module),
            )?.CaseTypeId,
          }
        : {}),
    });
  }
  function editAction(a: Row) {
    let extra: Row = {};
    try {
      extra = JSON.parse(a.DatosAdicionalesJson || "{}");
    } catch {}
    const fields = [
      "ActionTypeId",
      "AffectedSystemId",
      "Cie10Id",
      "StateId",
      "Descripcion",
      "DiagnosticoSst",
      "Temporalidad",
      "FechaCreacionManual",
      "PesoKg",
      "TallaM",
    ];
    const next: Row = {};
    fields.forEach((k) => {
      const value = a[k];
      next[k] = value && typeof value === "object" ? value[k] : (value ?? "");
    });
    next.segmento_corporal = Array.isArray(extra.segmento_corporal)
      ? extra.segmento_corporal.join(", ")
      : extra.segmento_corporal || "";
    ["hemicuerpo_afectado", "criticidad_sve", "origen"].forEach(
      (k) => (next[k] = extra[k] || ""),
    );
    setForm(next);
    setCie(a.Cie10Id);
    setEditId(a.StrapiId);
    setMode("action");
    setError("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: Row = {};
      Object.entries(form).forEach(([k, v]) => {
        if (
          v !== "" &&
          v != null &&
          ![
            "Nombre",
            "Documento",
            "Cargo",
            "Ciudad",
            "Area",
            "Departamento",
            "Direccion",
            "Genero",
            "Nacimiento",
            "Antiguedad",
            "segmento_corporal",
            "hemicuerpo_afectado",
            "criticidad_sve",
            "origen",
          ].includes(k)
        )
          payload[k] =
            k.endsWith("Id") || ["PesoKg", "TallaM"].includes(k)
              ? Number(v)
              : v;
      });
      if (mode === "action") {
        if (!editId) payload.ReportId = selected?.StrapiId;
        payload.Cie10Id = cie?.Cie10Id ?? null;
        if (module === "osteomuscular")
          payload.DatosAdicionalesJson = JSON.stringify({
            segmento_corporal: (form.segmento_corporal || "")
              .split(",")
              .map((v: string) => v.trim())
              .filter(Boolean),
            hemicuerpo_afectado: form.hemicuerpo_afectado || "",
            criticidad_sve: form.criticidad_sve || "",
            origen: form.origen || "",
          });
      } else if (form.Nombre || form.Documento)
        payload.ReportPeople = [
          {
            Role: "colaborador",
            Nombre: form.Nombre,
            Documento: form.Documento,
            Cargo: form.Cargo,
            Ciudad: form.Ciudad,
            Area: form.Area,
            Departamento: form.Departamento,
            Direccion: form.Direccion,
            Genero: form.Genero,
            Nacimiento: form.Nacimiento || null,
            Antiguedad: form.Antiguedad || null,
          },
        ];
      await api(
        mode === "action"
          ? `sgsst/${module}/reports/${selected?.StrapiId}/actions${editId ? "/" + editId : ""}`
          : `sgsst/${module}/reports`,
        payload,
      );
      setMode(null);
      await load(true);
      if (selected)
        setSelected(await api(`sgsst/${module}/reports/${selected.StrapiId}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function field(name: string, title: string, type = "text", required = false) {
    return (
      <label key={name}>
        {title}
        {fk[name] ? (
          <select
            value={form[name] ?? ""}
            required={required}
            onChange={(e) => setForm({ ...form, [name]: e.target.value })}
          >
            <option value="">Seleccionar</option>
            {(options[fk[name]] || []).map((o) => (
              <option key={o[keyOf(fk[name])]} value={o[keyOf(fk[name])]}>
                {label(o)}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            step={type === "number" ? "0.01" : undefined}
            min={type === "number" ? "0.01" : undefined}
            required={required}
            value={form[name] ?? ""}
            onChange={(e) => setForm({ ...form, [name]: e.target.value })}
          />
        )}
      </label>
    );
  }
  if (!ready) return <p className="p-8">Cargando…</p>;
  if (!token && !isDevelopment)
    return (
      <main className="grid min-h-screen place-items-center bg-[#503629] p-6">
        <section className="w-full max-w-lg rounded-2xl bg-white p-9 text-center shadow-xl">
          <Heart size={36} className="mx-auto mb-5 text-[#9b7054]" />
          <h1 className="text-3xl font-semibold">SG-SST</h1>
          <p className="mt-3 text-stone-600">
            Abre esta aplicación desde la Intranet para iniciar sesión.
          </p>
          {authError && (
            <p role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-left text-sm text-red-700">
              {authError}
            </p>
          )}
        </section>
      </main>
    );
  if (!token)
    return (
      <main className="grid min-h-screen place-items-center bg-[#503629] p-6">
        <form
          onSubmit={login}
          className="w-full max-w-md rounded-2xl bg-white p-9 shadow-xl"
        >
          <Heart size={32} className="mb-6 text-[#9b7054]" />
          <h1 className="text-3xl font-semibold">SG-SST</h1>
          <p className="mt-2 mb-7 text-stone-500">
            Seguridad y salud en el trabajo
          </p>
          <label>
            Token de acceso
            <input
              type="password"
              autoComplete="off"
              required
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="Ingresa tu token"
            />
          </label>
          <Button className="mt-5 w-full" disabled={busy}>
            {busy ? "Conectando…" : "Ingresar"}
          </Button>
          {error && (
            <p role="alert" className="mt-4 text-red-700">
              {error}
            </p>
          )}
          <p className="mt-5 text-sm text-stone-400">
            Acceso local de desarrollo. No requiere abrir la Intranet.
          </p>
        </form>
      </main>
    );
  return (
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <aside className="bg-[#503629] text-white md:sticky md:top-0 md:h-screen flex flex-col p-5">
        <h1 className="mb-2 text-2xl font-semibold">SG-SST</h1>
        <p className="mb-5 text-sm text-white/60">Gestión de salud laboral</p>
        {identity && (
          <section className="mb-6 rounded-xl bg-white/10 p-3" aria-label="Usuario autenticado">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
              {identity.source === "intranet"
                ? "Sesión validada por Intranet"
                : "Sesión local de desarrollo"}
            </p>
            <p className="mt-1 truncate text-sm font-semibold">{identity.usuario.nombre}</p>
            <p className="truncate text-xs text-white/60">
              {identity.usuario.email_corporativo}
            </p>
            <details className="mt-2 text-xs text-white/60">
              <summary>Detalles de autenticación</summary>
              <dl className="mt-2 space-y-1">
                <div><dt className="inline text-white/40">Origen: </dt><dd className="inline">{identity.source}</dd></div>
                <div><dt className="inline text-white/40">Aplicación: </dt><dd className="inline">{identity.app || "—"}</dd></div>
                <div><dt className="inline text-white/40">ID de usuario: </dt><dd className="inline">{identity.usuario.id}</dd></div>
                <div><dt className="inline text-white/40">Expira: </dt><dd className="inline">{identity.expires_at || "Sesión local"}</dd></div>
              </dl>
            </details>
          </section>
        )}
        <nav className="flex flex-wrap gap-2 md:flex-col">
          {modules.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setModule(m.key);
                setSelected(null);
                setState("");
                setCity("");
                setSearch("");
                setExtraFilters({});
              }}
              className={`flex items-center gap-3 rounded-lg p-3 text-left ${module === m.key ? "bg-white text-[#503629]" : "hover:bg-white/10"}`}
            >
              <m.icon size={21} />
              {m.name}
            </button>
          ))}
        </nav>
        {isDevelopment && <button
          onClick={() => {
            sessionStorage.removeItem("sst_token");
            cache.current = {};
            requestVersion.current++;
            setToken("");
            setIdentity(null);
            setReports([]);
            setSelected(null);
          }}
          className="mt-8 md:mt-auto flex items-center gap-3 p-3 text-white/70"
        >
          <LogOut size={18} /> Cerrar sesión
        </button>}
      </aside>
      <main className="min-w-0 p-5 md:p-9">
        {module === "todos" && (
          <article className="mb-6 rounded-xl border bg-white p-6">
            <h2 className="text-2xl font-semibold">Perfiles y permisos</h2>
            <p className="mt-3">
              El panel original administra usuarios y acceso a módulos. La base
              sst todavía no dispone de tablas de perfiles y permisos para
              conectar esta administración.
            </p>
          </article>
        )}
        <header className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-sm text-stone-400">
              Gestión de casos / {current.name}
            </p>
            <h2 className="mt-1 text-3xl font-semibold">{current.name}</h2>
            <p className="mt-1 text-stone-500">
              Reportes, colaboradores y seguimiento de acciones
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              onClick={() => void load(true)}
              disabled={busy}
              aria-label="Actualizar"
            >
              <RefreshCw size={17} />
            </Button>
            <Button
              onClick={() => openForm("report")}
              disabled={busy || module === "todos"}
            >
              <Plus size={17} /> Nuevo reporte
            </Button>
          </div>
        </header>
        {error && !mode && (
          <p
            role="alert"
            className="my-5 rounded-lg bg-red-50 p-4 text-red-700"
          >
            {error}
          </p>
        )}
        <section className="my-7 grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            { name: "Total de casos", count: base.length, value: "" },
            {
              name: "Vencidos",
              count: base.filter(overdue).length,
              value: "vencido",
            },
            ...["Abierto", "En Seguimiento", "Cerrado"].map((s) => ({
              name: s,
              count: base.filter((r) => stateKey(r.StateId) === stateKey(s))
                .length,
              value: label(
                options.States?.find((o) => stateKey(o) === stateKey(s)) || s,
              ),
            })),
          ].map((k) => (
            <button
              key={k.name}
              onClick={() => setState(k.value)}
              className={`rounded-xl border bg-white p-5 text-left ${stateKey(state) === stateKey(k.value) ? "border-[#b89478]" : "border-stone-200"}`}
            >
              <p className="text-sm text-stone-500">{k.name}</p>
              <b className="mt-2 block text-3xl">{busy ? "…" : k.count}</b>
            </button>
          ))}
        </section>
        <Statistics reports={filtered} module={module} />
        <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 p-4">
            <div className="relative min-w-48 flex-1">
              <Search
                size={17}
                className="absolute left-3 top-3 text-stone-400"
              />
              <input
                className="pl-10"
                placeholder="Buscar por nombre, documento o descripción"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Ciudad"
              className="w-auto"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">Todas las ciudades</option>
              {cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Estado"
              className="w-auto"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">Todos los estados</option>
              {(options.States || []).map((s) => (
                <option key={s.StateId}>{label(s)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2 border-b border-stone-100 px-4 pb-4">
            {["Cargo", "Area", "Departamento", "Direccion", "Sistema"]
              .filter((k) => k !== "Sistema" || module === "salud_general")
              .map((k) => (
                <select
                  key={k}
                  aria-label={k}
                  className="max-w-48 text-sm"
                  value={extraFilters[k] || ""}
                  onChange={(e) =>
                    setExtraFilters({ ...extraFilters, [k]: e.target.value })
                  }
                >
                  <option value="">
                    {(
                      {
                        Area: "Área",
                        Direccion: "Dirección",
                        Sistema: "Sistema afectado",
                      } as Record<string, string>
                    )[k] || k}
                  </option>
                  {Array.from(
                    new Set(
                      base
                        .flatMap((r) =>
                          k === "Sistema"
                            ? (r.Actions || []).map((a: Row) =>
                                label(a.AffectedSystemId),
                              )
                            : people(r).map((p) => p[k]),
                        )
                        .filter(Boolean),
                    ),
                  )
                    .sort()
                    .map((v: any) => (
                      <option key={v}>{v}</option>
                    ))}
                </select>
              ))}
            <Button
              variant="ghost"
              onClick={() => {
                setExtraFilters({});
                setCity("");
                setState("");
                setSearch("");
              }}
            >
              Limpiar filtros
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {[
                    "Caso",
                    "Colaborador",
                    "Cargo y área",
                    "Categoría",
                    "Estado",
                    "Fecha",
                    "Acciones",
                    "",
                  ].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice((page - 1) * 10, page * 10).map((r) => {
                  const collaborator =
                    people(r).find((p) => p.Role === "colaborador") ||
                    people(r)[0];
                  return (
                    <tr key={r.StrapiId} className="hover:bg-stone-50">
                      <td>#{r.StrapiId}</td>
                      <td>
                        <div className="flex min-w-52 items-center gap-3">
                          <Avatar person={collaborator} />
                          <div>
                            <b>{collaborator?.Nombre || "Sin colaborador"}</b>
                            <p className="text-xs text-stone-500">
                              {collaborator?.Documento}
                            </p>
                            <p className="max-w-52 truncate text-xs text-stone-400">
                              {r.Descripcion}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span>{collaborator?.Cargo || "—"}</span>
                        <p className="text-xs text-stone-400">
                          {collaborator?.Area || "—"}
                        </p>
                      </td>
                      <td>{label(r.CategoryId)}</td>
                      <td>
                        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs">
                          {label(r.StateId)}
                        </span>
                      </td>
                      <td>{day(r.FechaCreacionManual || r.CreatedAt)}</td>
                      <td>{r.Actions?.length || 0}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (module === "todos") setSelected(r);
                            else void view(r);
                          }}
                        >
                          Ver seguimientos
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filtered.length && (
              <div className="p-14 text-center text-stone-400">
                <ClipboardList className="mx-auto mb-3" />
                {busy ? "Cargando casos…" : "No hay casos para estos filtros."}
              </div>
            )}
          </div>
          <footer className="flex items-center justify-between p-4 text-sm text-stone-500">
            <span>
              {filtered.length} casos · Página {page}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page * 10 >= filtered.length}
                onClick={() => setPage(page + 1)}
              >
                Siguiente
              </Button>
            </div>
          </footer>
        </section>
      </main>
      {selected && (
        <div
          className="fixed inset-0 z-20 bg-black/30"
          onClick={() => setSelected(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Detalle del caso"
            className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex justify-between">
              <div>
                <p className="text-stone-400">Detalle del reporte</p>
                <h2 className="text-2xl font-semibold">
                  Caso #{selected.StrapiId}
                </h2>
              </div>
              <Button
                variant="ghost"
                onClick={() => setSelected(null)}
                aria-label="Cerrar"
              >
                <X />
              </Button>
            </header>
            <p className="mt-6 whitespace-pre-wrap">
              {selected.Descripcion || "Sin descripción"}
            </p>
            <dl className="my-6 grid grid-cols-2 gap-4">
              {["CategoryId", "CaseTypeId", "StateId", "EntityId"].map(
                (k, i) => (
                  <div key={k}>
                    <dt className="text-sm text-stone-400">
                      {["Categoría", "Tipo de caso", "Estado", "Entidad"][i]}
                    </dt>
                    <dd>{label(selected[k])}</dd>
                  </div>
                ),
              )}
            </dl>
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              {people(selected).map((p) => (
                <div
                  key={p.ReportPersonId}
                  className="flex items-center gap-3 rounded-xl bg-stone-50 p-4"
                >
                  <Avatar person={p} size="lg" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#8a674f]">
                      {roleName(p.Role)}
                    </p>
                    <b className="block truncate">{p.Nombre}</b>
                    <p className="truncate text-sm text-stone-500">
                      {p.Documento} · {p.Cargo || p.Ciudad || "Sin cargo"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="my-6 flex items-center justify-between">
              <h3 className="text-xl font-semibold">
                Seguimientos ({selected.Actions?.length || 0})
              </h3>
              <Button
                disabled={module === "todos"}
                onClick={() => openForm("action")}
              >
                <Plus size={16} /> Nueva acción
              </Button>
            </div>
            {(selected.Actions || []).map((a: Row) => (
              <article
                key={a.StrapiId}
                className="mb-4 rounded-xl border border-stone-200 p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{label(a.ActionTypeId)}</b>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => editAction(a)}
                    >
                      Editar
                    </Button>
                    <span className="text-sm text-stone-400">
                      {day(a.FechaCreacionManual || a.CreatedAt)}
                    </span>
                  </div>
                </div>
                {(a.ActionPeople || []).length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    {a.ActionPeople.map((person: Row) => (
                      <div
                        key={person.ActionPersonId}
                        className="flex items-center gap-2 rounded-full bg-stone-50 py-1.5 pl-1.5 pr-4"
                      >
                        <Avatar person={person} size="sm" />
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                            {roleName(person.Role)}
                          </p>
                          <p className="text-sm font-medium">{person.Nombre}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="my-3 whitespace-pre-wrap">{a.Descripcion}</p>
                <p className="text-sm">{a.DiagnosticoSst}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-stone-400">Sistema</dt>
                    <dd>{label(a.AffectedSystemId)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400">CIE-10</dt>
                    <dd>
                      {a.Cie10Id?.Code || a.Cie10Id?.Codigo}{" "}
                      {a.Cie10Id?.Diagnostico || a.Cie10Id?.Descripcion}
                    </dd>
                  </div>
                  {a.PesoKg && (
                    <div>
                      <dt className="text-stone-400">Peso / talla</dt>
                      <dd>
                        {a.PesoKg} kg · {a.TallaM || "—"} m
                      </dd>
                    </div>
                  )}
                </dl>
                {a.DatosAdicionalesJson && (
                  <details className="mt-3 text-sm">
                    <summary>Datos del seguimiento</summary>
                    <dl className="mt-2 grid gap-2 rounded bg-stone-50 p-3">
                      {(() => {
                        try {
                          return Object.entries(
                            JSON.parse(a.DatosAdicionalesJson),
                          ).map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-stone-400">
                                {key.replaceAll("_", " ")}
                              </dt>
                              <dd>
                                {Array.isArray(value)
                                  ? value.join(", ")
                                  : typeof value === "object"
                                    ? JSON.stringify(value)
                                    : String(value || "—")}
                              </dd>
                            </div>
                          ));
                        } catch {
                          return <p>Sin datos adicionales</p>;
                        }
                      })()}
                    </dl>
                  </details>
                )}
                <p className="mt-3 text-sm text-stone-500">
                  {label(a.StateId)} · Próximo seguimiento:{" "}
                  {day(a.Temporalidad)}
                </p>
              </article>
            ))}
          </section>
        </div>
      )}
      <dialog
        ref={modal}
        onCancel={() => setMode(null)}
        onClose={() => setMode(null)}
      >
        <form onSubmit={save} className="p-7">
          <header className="mb-6 flex justify-between">
            <h2 className="text-2xl font-semibold">
              {mode === "report"
                ? "Nuevo reporte"
                : editId
                  ? "Editar seguimiento"
                  : "Nueva acción"}
            </h2>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode(null)}
              aria-label="Cerrar"
            >
              <X />
            </Button>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === "report" ? (
              <>
                {field("Nombre", "Nombre del colaborador", "text", true)}
                {field("Documento", "Documento", "text", true)}
                {field("Cargo", "Cargo")}
                {field("Ciudad", "Ciudad")}
                {field("Area", "Área")}
                {field("Departamento", "Departamento")}
                {field("Direccion", "Dirección")}
                {field("Genero", "Género")}
                {field("Nacimiento", "Fecha de nacimiento", "date")}
                {field("Antiguedad", "Fecha de ingreso", "date")}
                {field("CaseTypeId", "Tipo de caso", "text", true)}
                {field("CategoryId", "Categoría")}
                {field("EntityTypeId", "Tipo de entidad")}
                {field("EntityId", "Entidad")}
              </>
            ) : (
              <>
                {field("ActionTypeId", "Tipo de acción", "text", true)}
                {module === "salud_general" &&
                  field("AffectedSystemId", "Sistema afectado")}
                {field("DiagnosticoSst", "Diagnóstico SST")}
                {field("Temporalidad", "Próximo seguimiento", "date")}
                {module !== "salud_mental" && (
                  <>
                    {field("PesoKg", "Peso (kg)", "number")}
                    {field("TallaM", "Talla (m)", "number")}
                    {Number(form.TallaM) > 0 && Number(form.PesoKg) > 0 && (
                      <p className="rounded bg-stone-50 p-3 text-sm sm:col-span-2">
                        IMC calculado:{" "}
                        {(
                          Number(form.PesoKg) /
                          Number(form.TallaM) ** 2
                        ).toFixed(2)}
                      </p>
                    )}
                  </>
                )}
                {module === "osteomuscular" && (
                  <>
                    {field(
                      "segmento_corporal",
                      "Segmentos corporales (separados por coma)",
                    )}
                    {field("hemicuerpo_afectado", "Hemicuerpo afectado")}
                    {field("criticidad_sve", "Criticidad SVE")}
                    {field("origen", "Origen")}
                  </>
                )}
                <CieSearch
                  token={token}
                  module={module}
                  value={cie}
                  onChange={setCie}
                />
              </>
            )}
            {field("StateId", "Estado", "text", true)}
            {field("FechaCreacionManual", "Fecha", "date", true)}
            <label className="sm:col-span-2">
              Descripción
              <textarea
                required
                rows={4}
                value={form.Descripcion || ""}
                onChange={(e) =>
                  setForm({ ...form, Descripcion: e.target.value })
                }
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="mt-4 text-red-700">
              {error}
            </p>
          )}
          <footer className="mt-7 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setMode(null)}
            >
              Cancelar
            </Button>
            <Button disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
