'use client';

import './admin.css';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { Activity, Download, ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, CreditCard, Crown, FileClock, LayoutDashboard, LoaderCircle, LogOut, Menu, RefreshCw, Search, ShieldCheck, Users, Wallet, X } from 'lucide-react';

const firebaseConfig = {
  apiKey: 'AIzaSyDW3FkTaaLWTkJTZo6gPBPKpu3dwoRRDxE',
  authDomain: 'mi-oficio-saas.firebaseapp.com',
  projectId: 'mi-oficio-saas',
  storageBucket: 'mi-oficio-saas.firebasestorage.app',
  messagingSenderId: '111343265249',
  appId: '1:111343265249:web:f0ac5b256378cb7a00dea0',
  databaseURL: 'https://mi-oficio-saas-default-rtdb.firebaseio.com',
};
const firebaseApp = getApps().find(a => a.name === '[DEFAULT]') ?? initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const ADMIN_UID = '1Vgtmx41b3hlzh9AYRloVUHBZg62';
const ADMIN_EMAIL = 'riosmiguelr3@gmail.com';

type Section = 'Resumen' | 'Usuarios' | 'Premium' | 'Pagos' | 'Casos' | 'Auditoría';
type AdminUser = { uid: string; email: string; name: string; disabled: boolean; createdAt: string; lastLogin: string; premium: boolean; expiresAt: number | null };
type Order = { id: string; uid?: string; email?: string; status?: string; amount?: number; currency?: string; createdAt?: number; paymentId?: string; needsReview?: boolean; plan?: string };
type AuditItem = { id: string; at?: number; actor?: string; adminUid?: string; action?: string; reason?: string; uid?: string; orderId?: string; paymentId?: string };
type Payment = { id: number; status: string; statusDetail?: string | null; amount?: number; currency?: string; createdAt?: string; approvedAt?: string; externalReference?: string | null; method?: string | null; payerEmail?: string | null };
type FoundUser = { uid: string; email: string | null; displayName: string | null; disabled: boolean; createdAt: string };
type UserProfile = { uid: string; email: string | null; displayName: string | null; emailVerified: boolean; providerIds: string[]; disabled: boolean; createdAt: string; lastLogin: string; business: Record<string, unknown>; businessFound: boolean; premium: boolean; expiresAt: number | null; profileKey: string | null };
type ApiResult = { ok: boolean; error?: string; [key: string]: unknown };
const nav = [
  { label: 'Resumen', Icon: LayoutDashboard }, { label: 'Usuarios', Icon: Users },
  { label: 'Premium', Icon: Crown }, { label: 'Pagos', Icon: CreditCard },
  { label: 'Casos', Icon: ClipboardList }, { label: 'Auditoría', Icon: FileClock },
] as const;
const dateText = (value?: number | string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(d);
};
const money = (value?: number, currency = 'ARS') => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: /^[A-Z]{3}$/.test(currency) ? currency : 'ARS' }).format(value) : '—';
const statusLabel = (value?: string) => ({ approved: 'Aprobado', pending: 'Pendiente', rejected: 'Rechazado', refunded: 'Reembolsado', charged_back: 'Contracargo', in_process: 'En proceso' } as Record<string, string>)[value ?? ''] ?? (value || 'Sin estado');
const statusTone = (value?: string) => value === 'approved' ? 'good' : value === 'rejected' || value === 'charged_back' ? 'bad' : 'neutral';

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [section, setSection] = useState<Section>('Resumen');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [notes, setNotes] = useState<AuditItem[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [found, setFound] = useState<FoundUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [foundPremium, setFoundPremium] = useState(false);
  const [foundExpiry, setFoundExpiry] = useState<number | null>(null);
  const [selectedUid, setSelectedUid] = useState('');
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [noteUid, setNoteUid] = useState('');
  const [noteReason, setNoteReason] = useState('');
  const [filter, setFilter] = useState('Todos');
  const [orderSearch, setOrderSearch] = useState('');
  const [userFilter, setUserFilter] = useState('Todos');
  const isAdmin = user?.uid === ADMIN_UID && user.email?.toLowerCase() === ADMIN_EMAIL && user.emailVerified;

  useEffect(() => onAuthStateChanged(auth, current => { setUser(current); setAuthReady(true); }), []);

  const request = useCallback(async (path: string, options?: { method?: string; body?: unknown }) => {
    const current = auth.currentUser;
    if (!current) throw new Error('Iniciá sesión para continuar.');
    const token = await current.getIdToken();
    const response = await fetch(path, {
      method: options?.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });
    const result = (await response.json()) as ApiResult;
    if (!response.ok || !result.ok) throw new Error(typeof result.error === 'string' ? result.error : `Error HTTP ${response.status}`);
    return result;
  }, []);

  const load = useCallback(async (target: Section, nextCursor?: string) => {
    setLoading(true); setError('');
    try {
      if (target === 'Resumen') {
        const [u, p, a] = await Promise.all([
          request('/api/admin?section=users'), request('/api/admin?section=payments'), request('/api/admin?section=history'),
        ]);
        setUsers((u.users ?? []) as AdminUser[]); setCursor((u.cursor ?? null) as string | null);
        setOrders((p.orders ?? []) as Order[]); setAudit((a.items ?? []) as AuditItem[]);
      } else if (target === 'Usuarios' || target === 'Premium') {
        const data = await request(`/api/admin?section=users${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ''}`);
        setUsers(prev => nextCursor ? [...prev, ...((data.users ?? []) as AdminUser[])] : (data.users ?? []) as AdminUser[]);
        setCursor((data.cursor ?? null) as string | null);
      } else if (target === 'Pagos') {
        const data = await request('/api/admin?section=payments'); setOrders((data.orders ?? []) as Order[]);
      } else if (target === 'Casos') {
        const data = await request('/api/admin?section=notes'); setNotes((data.items ?? []) as AuditItem[]);
      } else {
        const data = await request('/api/admin?section=history'); setAudit((data.items ?? []) as AuditItem[]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los datos.'); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { if (isAdmin) void load(section); }, [isAdmin, section, load]);
  const changeSection = (s: Section) => { setSection(s); setMobileMenu(false); setNotice(''); setError(''); };
  const execute = async (task: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); } finally { setBusy(false); } };
  const lookup = async (q = userQuery) => execute(async () => {
    if (!q.trim()) throw new Error('Ingresá un UID o correo.');
    const data = await request(`/api/admin/users?q=${encodeURIComponent(q.trim())}`);
    const match = data.user as FoundUser;
    setFound(match); setFoundPremium(Boolean(data.premium)); setFoundExpiry((data.expiresAt ?? null) as number | null);
    setSelectedUid(match.uid); setNoteUid(match.uid);
    await openProfile(match.uid);
  });
  const openProfile = async (uid: string) => {
    setSection('Usuarios'); setMobileMenu(false); setProfile(null); setProfileLoading(true); setError('');
    try {
      const data = await request(`/api/admin/profile?uid=${encodeURIComponent(uid)}`);
      const p = data.profile as UserProfile;
      setProfile(p); setSelectedUid(p.uid); setUserQuery(p.email || p.uid);
      setFound({uid:p.uid,email:p.email,displayName:p.displayName,disabled:p.disabled,createdAt:p.createdAt});
      setFoundPremium(p.premium); setFoundExpiry(p.expiresAt);
      setNoteUid(p.uid);
    } catch(e) { setError(e instanceof Error ? e.message : 'No se pudo consultar la ficha.'); }
    finally { setProfileLoading(false); }
  };
  const login = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void execute(async () => {
    setLoggingIn(true);
    try { await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword); setLoginPassword(''); }
    finally { setLoggingIn(false); }
  }); };
  const loginWithGoogle = () => { void execute(async () => {
    setLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      setLoginPassword('');
    } catch (e) {
      if (e instanceof Error && e.message.includes('auth/popup-closed-by-user')) return;
      throw e;
    } finally { setLoggingIn(false); }
  }); };
  const managePremium = (action: 'grant' | 'free') => execute(async () => {
    if (!selectedUid.trim()) throw new Error('Seleccioná primero un usuario válido.');
    if (reason.trim().length < 5) throw new Error('Ingresá un motivo de al menos cinco caracteres.');
    const actionName = action === 'grant' ? `activar o extender Premium por ${days} días` : 'revocar Premium';
    if (!window.confirm(`¿Confirmás ${actionName} para el UID ${selectedUid}? Esta acción se registrará.`)) return;
    const requestId = crypto.randomUUID();
    const data = await request('/api/admin/premium', { method: 'POST', body: { uid: selectedUid, action, days: action === 'grant' ? days : undefined, reason: reason.trim(), requestId } });
    setNotice(data.duplicate ? 'La solicitud ya había sido procesada.' : 'Membresía actualizada correctamente.');
    setReason(''); setFoundPremium(!Boolean(data.revoked) && Number(data.expiresAt) > Date.now());
    setFoundExpiry((data.expiresAt ?? null) as number | null);
    await load('Premium');
  });
  const lookupPayment = () => execute(async () => {
    if (!/^\d{1,30}$/.test(paymentId.trim())) throw new Error('Ingresá el ID numérico del pago.');
    const data = await request(`/api/admin/payments?id=${encodeURIComponent(paymentId.trim())}`);
    setPayment(data.payment as Payment);
  });
  const addNote = () => execute(async () => {
    if (!noteUid.trim()) throw new Error('Ingresá el UID del usuario.');
    if (noteReason.trim().length < 5) throw new Error('El motivo debe tener al menos cinco caracteres.');
    if (!window.confirm('¿Registrar esta nota administrativa?')) return;
    await request('/api/admin', { method: 'POST', body: { action: 'note', uid: noteUid.trim(), reason: noteReason.trim(), operationId: crypto.randomUUID() } });
    setNotice('Nota registrada correctamente.'); setNoteReason(''); await load('Casos');
  });
  const filteredOrders = orders.filter(o => {
    const matchesStatus = filter === 'Todos' || o.status === filter;
    const q = orderSearch.trim().toLowerCase();
    return matchesStatus && (!q || [o.id, o.uid, o.email, o.paymentId, o.plan].some(v => String(v ?? '').toLowerCase().includes(q)));
  });
  const filteredUsers = users.filter(u => userFilter === 'Todos' || (userFilter === 'Premium' ? u.premium : userFilter === 'Free' ? !u.premium : u.disabled));
  const exportOrders = () => {
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""').replace(/^[=+@\-]/, "'$&")}"`;
    const rows = [['Orden', 'Usuario', 'Estado', 'Importe', 'Moneda', 'Fecha', 'ID pago', 'Revisión'], ...filteredOrders.map(o => [o.id, o.email || o.uid || '', o.status || '', o.amount ?? '', o.currency || '', dateText(o.createdAt), o.paymentId || '', o.needsReview ? 'Sí' : 'No'])];
    const csv = '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mioficio-ordenes-consultadas.csv'; link.click();
    URL.revokeObjectURL(url);
  };
  const premiumCount = users.filter(u => u.premium).length;
  const reviewCount = orders.filter(o => o.needsReview).length;
  const approvedCount = orders.filter(o => o.status === 'approved').length;

  if (!authReady) return <div className="admin-gate"><LoaderCircle className="spin" size={28}/><p>Verificando sesión…</p></div>;
  if (!user) return <main className="admin-gate"><div className="admin-login"><div className="admin-logo">M<span>·</span></div><span className="admin-kicker">MIOFICIO / ACCESO RESTRINGIDO</span><h1>Administración</h1><p>Ingresá con tu cuenta administradora de Firebase.</p><form onSubmit={login}><label>Correo electrónico<input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required autoComplete="username" /></label><label>Contraseña<input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required autoComplete="current-password" /></label><button className="admin-primary" disabled={busy || loggingIn}>{busy ? 'Ingresando…' : 'Iniciar sesión'} <ArrowRight size={17}/></button></form><div style={{display:"flex",alignItems:"center",gap:12,margin:"18px 0",color:"#64748b",fontSize:13}}><span style={{height:1,background:"#dbe3ee",flex:1}}/>o continuá con<span style={{height:1,background:"#dbe3ee",flex:1}}/></div><button type="button" className="admin-primary" style={{width:"100%",justifyContent:"center",background:"#fff",color:"#17263d",border:"1px solid #cbd5e1"}} onClick={loginWithGoogle} disabled={busy || loggingIn}>Continuar con Google <ArrowRight size={17}/></button>{error && <p className="admin-error">{error}</p>}<small><ShieldCheck size={14}/> Acceso verificado en el servidor</small></div></main>;
  if (!isAdmin) return <main className="admin-gate"><div className="admin-login"><ShieldCheck size={34}/><h1>Acceso restringido</h1><p>Esta cuenta no está autorizada para administrar MiOficio.</p><button className="admin-primary" onClick={() => void signOut(auth)}>Cerrar sesión</button></div></main>;

  return <div className="admin-shell">
    <aside className={`admin-sidebar ${mobileMenu ? 'open' : ''}`}>
      <div className="admin-brand"><div className="admin-logo">M<span>·</span></div><div><strong>MiOficio</strong><small>ADMINISTRACIÓN</small></div><button className="admin-mobile-close" aria-label="Cerrar menú" onClick={() => setMobileMenu(false)}><X size={19}/></button></div>
      <div className="admin-side-caption">ESPACIO DE TRABAJO</div>
      <nav aria-label="Administración">{nav.map(({ label, Icon }) => <button key={label} className={`admin-nav-item ${section === label ? 'active' : ''}`} onClick={() => changeSection(label)}><Icon size={19}/><span>{label}</span>{section === label && <span className="admin-nav-dot"/>}</button>)}</nav>
      <div className="admin-side-bottom"><div className="admin-secure"><ShieldCheck size={18}/><div><strong>Entorno protegido</strong><small>Autenticación Firebase</small></div></div><button className="admin-signout" onClick={() => void signOut(auth)}><LogOut size={17}/> Cerrar sesión</button></div>
    </aside>
    {mobileMenu && <button className="admin-backdrop" aria-label="Cerrar menú" onClick={() => setMobileMenu(false)}/>}
    <div className="admin-main"><div className="admin-topbar"><div className="admin-top-left"><button className="admin-menu-button" aria-label="Abrir menú" onClick={() => setMobileMenu(true)}><Menu size={22}/></button><span>Panel de administración</span><ChevronRight size={14}/><strong>{section}</strong></div><div className="admin-profile"><span className="admin-online"/><div><strong>Administrador</strong><small>{user.email}</small></div><span className="admin-avatar">MR</span></div></div>
      <main className="admin-content"><div className="admin-heading"><div><div className="admin-kicker">MIOFICIO / CENTRO DE CONTROL</div><h1>{section === 'Resumen' ? 'Resumen general' : section}</h1><p>{section === 'Resumen' ? 'Supervisá la actividad y las operaciones de tu plataforma.' : ({ Usuarios: 'Consultá y administrá las cuentas registradas.', Premium: 'Gestioná las membresías y sus vencimientos.', Pagos: 'Verificá operaciones y órdenes de Mercado Pago.', Casos: 'Registrá notas y seguí las revisiones administrativas.', Auditoría: 'Consultá las acciones registradas por el sistema.' } as Record<string,string>)[section]}</p></div><button className="admin-refresh" onClick={() => void load(section)} disabled={loading}><RefreshCw size={17} className={loading ? 'spin' : ''}/> Actualizar</button></div>
      {error && <div className="admin-alert error"><CircleAlert size={18}/><span>{error}</span><button onClick={() => setError('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
      {notice && <div className="admin-alert success"><BadgeCheck size={18}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={16}/></button></div>}
      {section === 'Resumen' && <><div className="admin-kpi-grid"><Kpi icon={<Users size={20}/>} title="Usuarios consultados" value={loading && !users.length ? '…' : error && !users.length ? '—' : String(users.length)} foot={cursor ? 'Primera página · hay más usuarios' : 'Página de usuarios disponible'}/><Kpi icon={<Crown size={20}/>} title="Premium en esta página" value={error && !users.length ? '—' : String(premiumCount)} foot="No representa el total global"/><Kpi icon={<Wallet size={20}/>} title="Órdenes aprobadas" value={error && !orders.length ? '—' : String(approvedCount)} foot="Entre las últimas 200 órdenes"/><Kpi icon={<Activity size={20}/>} title="Órdenes a revisar" value={error && !orders.length ? '—' : String(reviewCount)} foot="Entre las últimas 200 órdenes"/></div><section className="admin-workbench" aria-label="Accesos operativos"><div><strong>Centro de operaciones</strong><span>Accedé a las tareas administrativas sin duplicar funciones.</span></div><div className="admin-workbench-actions"><button onClick={() => changeSection('Usuarios')}><Users size={15}/> Cuentas</button><button onClick={() => changeSection('Premium')}><Crown size={15}/> Membresías</button><button onClick={() => changeSection('Pagos')}><CreditCard size={15}/> Operaciones</button>{reviewCount > 0 && <button className="admin-urgent" onClick={() => changeSection('Pagos')}><CircleAlert size={15}/> {reviewCount} por revisar</button>}</div></section><div className="admin-two-cols"><section className="admin-card"><div className="admin-card-head"><div><h2>Operaciones recientes</h2><p>Últimas órdenes registradas en MiOficio</p></div><button className="admin-text-button" onClick={() => changeSection('Pagos')}>Ver pagos <ArrowRight size={15}/></button></div><OrdersTable orders={orders.slice(0,6)}/></section><section className="admin-card"><div className="admin-card-head"><div><h2>Actividad administrativa</h2><p>Últimos eventos del registro general</p></div><button className="admin-text-button" onClick={() => changeSection('Auditoría')}>Ver auditoría <ArrowRight size={15}/></button></div><EventsList items={audit.slice(0,6)}/></section></div><div className="admin-info"><CircleAlert size={17}/><span>Las cifras corresponden a los registros consultados: la API pagina usuarios de 50 en 50 y limita las órdenes a las últimas 200.</span></div></>}
      {section === 'Usuarios' && <><section className="admin-card"><div className="admin-card-head"><div><h2>Buscar usuario</h2><p>Búsqueda exacta por correo electrónico o UID</p></div><Search size={19}/></div><form className="admin-inline-form" onSubmit={e => { e.preventDefault(); void lookup(); }}><input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder="correo@ejemplo.com o UID" aria-label="Correo o UID"/><button className="admin-primary" disabled={busy}>{busy ? 'Buscando…' : 'Buscar'}</button></form>{found && <div className="admin-result"><div><strong>{found.displayName || found.email || found.uid}</strong><small>{found.email || 'Sin correo'} · {found.uid}</small></div><span className={`admin-pill ${foundPremium ? 'good' : 'neutral'}`}>{foundPremium ? `Premium hasta ${dateText(foundExpiry)}` : 'Free'}</span><button className="admin-outline" onClick={() => void openProfile(found.uid)}>Abrir ficha completa</button></div>}</section>{profileLoading && <section className="admin-card"><LoaderCircle className="spin" size={19}/> Consultando la ficha verificada…</section>}{profile && <section className="admin-card admin-profile-card"><div className="admin-card-head"><div><h2>Ficha completa del usuario</h2><p>Identidad, datos comerciales y membresía · solo lectura</p></div><button className="admin-outline" onClick={() => setProfile(null)}><X size={15}/> Cerrar ficha</button></div><div className="admin-profile-hero"><div><strong>{profile.displayName || profile.business.nombre?.toString() || profile.email || 'Usuario sin nombre'}</strong><small>{profile.email || 'Correo no informado'}</small></div><span className={`admin-pill ${profile.premium ? 'premium' : 'neutral'}`}>{profile.premium ? 'Premium vigente' : 'Free / sin Premium vigente'}</span></div><div className="admin-profile-groups"><div><h3>Identificación y acceso</h3><ProfileRow label="UID de Firebase" value={profile.uid}/><ProfileRow label="Nombre y apellido" value={profile.displayName}/><ProfileRow label="Correo" value={profile.email}/><ProfileRow label="Correo verificado" value={profile.emailVerified ? 'Sí' : 'No'}/><ProfileRow label="Proveedor" value={profile.providerIds.join(', ')}/><ProfileRow label="Estado de acceso" value={profile.disabled ? 'Deshabilitado' : 'Habilitado'}/><ProfileRow label="Registro" value={dateText(profile.createdAt)}/><ProfileRow label="Último acceso" value={dateText(profile.lastLogin)}/></div><div><h3>Mi negocio · datos guardados</h3>{!profile.businessFound && <p className="admin-profile-warning">No se encontró un perfil comercial asociado de forma segura.</p>}<ProfileRow label="Nombre comercial" value={profile.business.nombre}/><ProfileRow label="Rubro" value={profile.business.oficio_rubro}/><ProfileRow label="DNI / CUIT" value={profile.business.cuit || profile.business.dni || profile.business.cuit_dni}/><ProfileRow label="Condición fiscal" value={profile.business.condicion_iva}/><ProfileRow label="Ingresos Brutos" value={profile.business.iibb}/><ProfileRow label="Domicilio" value={profile.business.direccion}/><ProfileRow label="Localidad" value={profile.business.localidad}/><ProfileRow label="Código postal" value={profile.business.codigo_postal}/><ProfileRow label="Teléfono" value={profile.business.telefono}/><ProfileRow label="Correo comercial" value={profile.business.email}/><ProfileRow label="Moneda" value={profile.business.moneda_default}/></div><div><h3>Membresía y preferencias</h3><ProfileRow label="Membresía verificada" value={profile.premium ? 'Premium vigente' : 'Free / sin Premium vigente'}/><ProfileRow label="Vencimiento" value={dateText(profile.expiresAt)}/><ProfileRow label="Activación registrada" value={dateText(profile.business.premium_activado_at as string | undefined)}/><ProfileRow label="Importe registrado (no acredita pago)" value={profile.business.premium_amount}/><ProfileRow label="IVA predeterminado" value={profile.business.iva_default}/><ProfileRow label="Plantilla" value={profile.business.plantilla_estilo}/><ProfileRow label="Efectivo" value={typeof profile.business.acepta_efectivo === 'boolean' ? (profile.business.acepta_efectivo ? 'Sí' : 'No') : null}/><ProfileRow label="Transferencia" value={typeof profile.business.acepta_transferencia === 'boolean' ? (profile.business.acepta_transferencia ? 'Sí' : 'No') : null}/><ProfileRow label="Cheque" value={typeof profile.business.acepta_cheque === 'boolean' ? (profile.business.acepta_cheque ? 'Sí' : 'No') : null}/></div></div><div className="admin-actions"><button className="admin-primary" onClick={() => { setSelectedUid(profile.uid); changeSection('Premium'); }}><Crown size={16}/> Gestionar membresía</button><button className="admin-outline" onClick={() => { setNoteUid(profile.uid); changeSection('Casos'); }}><ClipboardList size={16}/> Registrar seguimiento</button></div><p className="admin-profile-foot">Los campos ausentes se muestran como «No informado». La ficha no permite modificar datos del cliente. Las operaciones financieras deben verificarse en Pagos.</p></section>}<section className="admin-card"><div className="admin-card-head"><div><h2>Usuarios registrados</h2><p>{users.length} cuentas cargadas {cursor ? '· hay más páginas' : ''}</p></div></div><div className="admin-toolbar"><span>Filtrar cuentas cargadas</span><select aria-label="Filtrar usuarios cargados" value={userFilter} onChange={e => setUserFilter(e.target.value)}><option>Todos</option><option>Premium</option><option>Free</option><option>Deshabilitados</option></select><small>Filtro aplicado solo a los registros cargados</small></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Usuario</th><th>Estado</th><th>Plan</th><th>Registro</th><th>Acción</th></tr></thead><tbody>{filteredUsers.map(u => <tr key={u.uid}><td><strong>{u.name || u.email || 'Sin nombre'}</strong><small>{u.email || u.uid}</small></td><td><span className={`admin-pill ${u.disabled ? 'bad' : 'good'}`}>{u.disabled ? 'Deshabilitado' : 'Activo'}</span></td><td><span className={`admin-pill ${u.premium ? 'premium' : 'neutral'}`}>{u.premium ? 'Premium' : 'Free'}</span></td><td>{dateText(u.createdAt)}</td><td><button className="admin-text-button" onClick={() => void openProfile(u.uid)}>Gestionar <ArrowRight size={14}/></button></td></tr>)}</tbody></table>{!users.length && <Empty text={loading ? 'Cargando usuarios…' : 'No se encontraron usuarios en esta página.'}/>}</div>{cursor && <div className="admin-card-footer"><button className="admin-outline" disabled={loading} onClick={() => void load('Usuarios', cursor)}>{loading ? 'Cargando…' : 'Cargar otros 50 usuarios'} <ChevronRight size={16}/></button></div>}</section></>}
      {section === 'Premium' && <div className="admin-two-cols admin-premium-layout"><section className="admin-card"><div className="admin-card-head"><div><h2>Gestión de membresía</h2><p>Activaciones y revocaciones seguras</p></div><Crown size={21}/></div><label className="admin-field">UID del usuario<input value={selectedUid} onChange={e => {setSelectedUid(e.target.value);setFound(null);}} placeholder="Seleccioná un usuario desde Usuarios"/></label><label className="admin-field">Duración de activación<select value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>1 día</option><option value={7}>7 días</option><option value={30}>30 días</option><option value={365}>365 días</option></select></label><label className="admin-field">Motivo obligatorio<textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Explicá el motivo de la operación (mínimo 5 caracteres)" rows={4}/></label><div className="admin-actions"><button className="admin-primary" disabled={busy || !selectedUid || reason.trim().length < 5} onClick={() => void managePremium('grant')}><Crown size={16}/> Activar o extender</button><button className="admin-outline danger" disabled={busy || !selectedUid || reason.trim().length < 5} onClick={() => void managePremium('free')}>Revocar Premium</button></div><div className="admin-info"><ShieldCheck size={17}/>Las operaciones se verifican en el servidor y se registran en el historial de la membresía.</div></section><section className="admin-card"><div className="admin-card-head"><div><h2>Cuenta seleccionada</h2><p>Información de la membresía</p></div></div>{found && found.uid === selectedUid ? <div className="admin-selected"><span className="admin-user-icon"><Users size={24}/></span><h3>{found.displayName || found.email || 'Usuario'}</h3><p>{found.email || found.uid}</p><span className={`admin-pill ${foundPremium ? 'premium' : 'neutral'}`}>{foundPremium ? 'Premium activo' : 'Plan Free'}</span><div className="admin-detail"><span>UID</span><strong>{found.uid}</strong></div><div className="admin-detail"><span>Vencimiento</span><strong>{dateText(foundExpiry)}</strong></div></div> : <Empty text="Seleccioná un usuario desde Usuarios para ver su información verificada."/>}</section></div>}
      {section === 'Pagos' && <><section className="admin-card"><div className="admin-card-head"><div><h2>Verificar pago en Mercado Pago</h2><p>Consulta segura por identificador numérico</p></div><CreditCard size={21}/></div><form className="admin-inline-form" onSubmit={e => {e.preventDefault();void lookupPayment();}}><input inputMode="numeric" value={paymentId} onChange={e => {setPaymentId(e.target.value);setPayment(null);}} placeholder="ID del pago" aria-label="ID del pago"/><button className="admin-primary" disabled={busy}>{busy ? 'Consultando…' : 'Verificar pago'}</button></form>{payment && <div className="admin-payment-details"><div className="admin-detail"><span>Pago</span><strong>#{payment.id}</strong></div><div className="admin-detail"><span>Estado</span><span className={`admin-pill ${statusTone(payment.status)}`}>{statusLabel(payment.status)}</span></div><div className="admin-detail"><span>Importe</span><strong>{money(payment.amount,payment.currency)}</strong></div><div className="admin-detail"><span>Medio</span><strong>{payment.method || '—'}</strong></div><div className="admin-detail"><span>Fecha de aprobación</span><strong>{dateText(payment.approvedAt)}</strong></div><div className="admin-detail"><span>Referencia</span><strong>{payment.externalReference || '—'}</strong></div><div className="admin-detail"><span>Correo del pagador</span><strong>{payment.payerEmail || '—'}</strong></div></div>}</section><section className="admin-card"><div className="admin-card-head"><div><h2>Órdenes recientes</h2><p>Hasta 200 órdenes registradas, no el historial completo</p></div><select className="admin-filter" aria-label="Filtrar pagos" value={filter} onChange={e => setFilter(e.target.value)}><option value="Todos">Todos los estados</option><option value="approved">Aprobados</option><option value="pending">Pendientes</option><option value="rejected">Rechazados</option><option value="refunded">Reembolsados</option><option value="charged_back">Contracargos</option></select></div><div className="admin-toolbar"><label className="admin-search-inline"><Search size={15}/><input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Filtrar por orden, usuario o pago" aria-label="Filtrar órdenes cargadas"/></label><span>{filteredOrders.length} de {orders.length} órdenes cargadas</span><button className="admin-outline" onClick={exportOrders} disabled={!filteredOrders.length}><Download size={15}/> Exportar CSV</button></div><OrdersTable orders={filteredOrders} onPayment={id => {setPaymentId(id);window.scrollTo({top:0,behavior:'smooth'});}}/></section></>}
      {section === 'Casos' && <div className="admin-two-cols"><section className="admin-card"><div className="admin-card-head"><div><h2>Nueva nota administrativa</h2><p>Dejá constancia de una revisión o reclamo</p></div><ClipboardList size={20}/></div><label className="admin-field">UID del usuario<input value={noteUid} onChange={e => setNoteUid(e.target.value)} placeholder="UID de Firebase"/></label><label className="admin-field">Detalle de la nota<textarea value={noteReason} onChange={e => setNoteReason(e.target.value)} rows={5} placeholder="Describí la situación y las acciones realizadas"/></label><button className="admin-primary" disabled={busy || !noteUid || noteReason.trim().length < 5} onClick={() => void addNote()}>Registrar nota <ArrowRight size={16}/></button><div className="admin-info"><CircleAlert size={17}/>Esta función registra notas administrativas; todavía no es un sistema de tickets con estados.</div></section><section className="admin-card"><div className="admin-card-head"><div><h2>Notas recientes</h2><p>Últimos 200 registros como máximo</p></div></div><EventsList items={notes}/></section></div>}
      {section === 'Auditoría' && <section className="admin-card"><div className="admin-card-head"><div><h2>Historial administrativo</h2><p>Últimos 200 eventos del registro general</p></div><ShieldCheck size={20}/></div><EventsList items={audit}/><div className="admin-info"><CircleAlert size={17}/>Las operaciones de /api/admin/premium también se registran en el historial de cada membresía y podrían no aparecer aquí.</div></section>}
      <footer className="admin-footer">MiOficio · Centro de administración <span>Acceso privado y operaciones verificadas</span></footer>
      </main></div>
  </div>;
}
function Kpi({ icon, title, value, foot }: { icon: ReactNode; title: string; value: string; foot: string }) { return <article className="admin-kpi"><span className="admin-kpi-icon">{icon}</span><span className="admin-kpi-title">{title}</span><strong>{value}</strong><small>{foot}</small></article>; }
function Empty({ text }: { text: string }) { return <div className="admin-empty"><ClipboardList size={25}/><p>{text}</p></div>; }
function OrdersTable({ orders, onPayment }: { orders: Order[]; onPayment?: (id: string) => void }) { return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Orden</th><th>Estado</th><th>Importe</th><th>Fecha</th><th>Detalle</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td><strong className="admin-mono">{o.id.slice(0,8)}…</strong><small>{o.email || o.uid || 'Sin correo'}</small></td><td><span className={`admin-pill ${statusTone(o.status)}`}>{statusLabel(o.status)}</span>{o.needsReview && <small className="admin-warning">Requiere revisión</small>}</td><td>{money(o.amount,o.currency)}</td><td>{dateText(o.createdAt)}</td><td>{onPayment && o.paymentId ? <button className="admin-text-button" onClick={() => onPayment(o.paymentId!)}>Ver pago <ArrowRight size={14}/></button> : <span className="admin-muted">—</span>}</td></tr>)}</tbody></table>{!orders.length && <Empty text="No hay órdenes disponibles para esta consulta."/>}</div>; }
function EventsList({ items }: { items: AuditItem[] }) { return <div className="admin-events">{items.length ? items.map(item => <div className="admin-event" key={item.id}><span className="admin-event-icon"><Activity size={17}/></span><div><strong>{item.action || 'Registro administrativo'}</strong><p>{item.reason || 'Sin detalle'}</p><small>{item.uid ? `Usuario: ${item.uid} · ` : ''}{dateText(item.at)}</small></div></div>) : <Empty text="No hay registros disponibles."/>}</div>; }

function ProfileRow({label,value}:{label:string;value:unknown}) { const display = value === null || value === undefined || value === '' ? 'No informado' : String(value); return <div className="admin-profile-row"><span>{label}</span><strong className={display === 'No informado' ? 'admin-profile-missing' : ''}>{display}</strong></div>; }
