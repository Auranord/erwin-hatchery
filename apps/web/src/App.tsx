import { useEffect, useState } from 'react';

type Role = 'owner' | 'admin' | 'moderator' | 'user';

type MeResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      user: {
        twitchUserId: string;
        login: string | null;
        displayName: string | null;
        avatarUrl: string | null;
      };
      roles: string[];
      isAdmin: boolean;
    };

type AdminUser = {
  id: string;
  twitchUserId: string;
  displayName: string | null;
  login: string | null;
  isDeleted: boolean;
  roles: string[];
};

type LedgerEntry = {
  id: string;
  userId: string | null;
  eventType: string;
  delta: unknown;
  isReverted: boolean;
  createdAt: string;
};

export function App(): JSX.Element {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inventoryJson, setInventoryJson] = useState<string>('');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const isAdminRoute = window.location.pathname.startsWith('/admin');

  async function loadMe(): Promise<void> {
    const response = await fetch('/api/me', { credentials: 'include' });
    setMe((await response.json()) as MeResponse);
  }

  async function loadUsers(search = ''): Promise<void> {
    const response = await fetch(`/api/admin/users?q=${encodeURIComponent(search)}`, { credentials: 'include' });
    if (response.ok) {
      const payload = (await response.json()) as { users: AdminUser[] };
      setUsers(payload.users);
    }
  }

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    if (isAdminRoute && me?.authenticated) {
      void loadUsers(query);
    }
  }, [isAdminRoute, me?.authenticated]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    await loadMe();
  }

  async function changeRole(userId: string, role: Role, action: 'grant' | 'revoke'): Promise<void> {
    await fetch(`/api/admin/users/${userId}/role`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, action, requestId: crypto.randomUUID() })
    });
    await loadUsers(query);
  }

  async function grantTestEgg(userId: string): Promise<void> {
    const response = await fetch(`/api/admin/users/${userId}/grant-test-mystery-egg`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), amount: 1 })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? 'Test-Mystery-Ei konnte nicht vergeben werden.');
    }
    await loadInventory(userId);
    await loadLedger(userId);
  }

  async function loadInventory(userId: string): Promise<void> {
    const response = await fetch(`/api/admin/users/${userId}/inventory`, { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { inventory: unknown };
    setInventoryJson(JSON.stringify(payload.inventory, null, 2));
  }

  async function loadLedger(userId?: string): Promise<void> {
    const response = await fetch(`/api/admin/ledger${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { entries: LedgerEntry[] };
    setLedgerEntries(payload.entries);
  }

  async function revertLedger(ledgerId: string, userId: string | null): Promise<void> {
    await fetch(`/api/admin/ledger/${ledgerId}/revert`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID() })
    });
    await loadLedger(userId ?? undefined);
    if (userId) await loadInventory(userId);
  }

  if (isAdminRoute) {
    if (!me?.authenticated || !me.isAdmin) return <main className="container"><section className="card"><h2>Adminbereich</h2><p>Zugriff verweigert.</p></section></main>;
    const selected = users.find((x) => x.id === selectedUserId) ?? null;

    return (
      <main className="container">
        <section className="card">
          <h2>Adminbereich</h2>
          <p>Nutzerverwaltung (Milestone 3 Fundament).</p>
          <p><a href="/">Zurück zur Startseite</a></p>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Suche nach Name, Login oder Twitch-ID" />
          <button onClick={() => void loadUsers(query)}>Suchen</button>
          <ul>
            {users.map((user) => (
              <li key={user.id}>
                <button onClick={() => setSelectedUserId(user.id)}>{user.displayName ?? user.login ?? user.twitchUserId}</button> · Rollen: {user.roles.join(', ') || 'user'}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Nutzerdetail</h2>
          {selected ? (
            <>
              <p><strong>{selected.displayName ?? selected.login}</strong> ({selected.twitchUserId})</p>
              <p>Rollen: {selected.roles.join(', ') || 'user'}</p>
              {me.roles.includes('owner') ? (
                <div>
                  <button onClick={() => void changeRole(selected.id, 'admin', 'grant')}>Als Admin setzen</button>
                  <button onClick={() => void changeRole(selected.id, 'admin', 'revoke')}>Admin entfernen</button>
                  <button onClick={() => void changeRole(selected.id, 'moderator', 'grant')}>Als Moderator setzen</button>
                  <button onClick={() => void changeRole(selected.id, 'moderator', 'revoke')}>Moderator entfernen</button>
                </div>
              ) : <p>Nur Owner dürfen Rollen ändern.</p>}
              <div>
                <button onClick={() => void grantTestEgg(selected.id)}>Test-Mystery-Ei vergeben</button>
                <button onClick={() => void loadInventory(selected.id)}>Inventar laden</button>
                <button onClick={() => void loadLedger(selected.id)}>Ledger laden</button>
              </div>
            </>
          ) : <p>Bitte einen Nutzer auswählen.</p>}
        </section>
        <section className="card">
          <h2>Inventar (JSON)</h2>
          <pre>{inventoryJson || 'Kein Inventar geladen.'}</pre>
        </section>
        <section className="card">
          <h2>Economy Ledger</h2>
          <ul>
            {ledgerEntries.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.eventType}</strong> · {new Date(entry.createdAt).toLocaleString()} · reverted: {String(entry.isReverted)}
                <button disabled={entry.isReverted || entry.eventType !== 'admin_test_mystery_egg_grant'} onClick={() => void revertLedger(entry.id, entry.userId)}>
                  Revert
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  const showAdminNav = me?.authenticated && (me.roles.includes('owner') || me.roles.includes('admin'));

  return (
    <main className="container">
      <header className="hero">
        <p className="badge">Öffentliche Vorschau · MVP</p>
        <h1>Erwin Hatchery</h1>
      </header>
      <section className="card">
        <h2>Login</h2>
        {me?.authenticated ? (
          <>
            <p>
              Angemeldet als <strong>{me.user.displayName ?? me.user.login}</strong>
            </p>
            {me.user.avatarUrl ? <img src={me.user.avatarUrl} alt="Profilbild" width={72} height={72} /> : null}
            <p>Rolle: {me.isAdmin ? 'Admin' : 'Spieler'}</p>
            {showAdminNav ? <p><a href="/admin">Zum Adminbereich</a></p> : null}
            <button onClick={() => void logout()}>Logout</button>
          </>
        ) : (
          <>
            <p>Bitte melde dich mit Twitch an.</p>
            <a href="/api/auth/twitch/login">Mit Twitch einloggen</a>
          </>
        )}
      </section>

      <section className="card">
        <h2>Spielbereich</h2>
        {me?.authenticated ? (
          <p>Du bist eingeloggt. Der authentifizierte Spielbereich ist bereit (Milestone 2).</p>
        ) : (
          <p>Nach dem Login siehst du hier deinen Spielbereich.</p>
        )}
      </section>
    </main>
  );
}
