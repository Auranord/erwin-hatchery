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

type AdminHealthIssue = {
  code: string;
  message: string;
};

type EventSubFeedItem = {
  id: string;
  twitchEventId: string;
  type: string;
  source: string;
  processingStatus: string;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
};


type EventSubSubscriptionStatus = {
  enabled: boolean;
  status: 'enabled' | 'missing' | 'error' | 'duplicate' | 'pending_verification';
  subscriptionId: string | null;
  type: string;
  callback: string;
  createdAt: string | null;
  lastCheckedAt: string;
  error: string | null;
};

type PlayerInventory = {
  mysteryEggs: Array<{ eggTypeId: string; amount: number }>;
  unhatchedEggs: Array<{ id: string; eggTypeId: string; state: string }>;
  hatchedPets: Array<{ id: string; petTypeId: string; createdAt: string }>;
  consumables: Array<{ consumableTypeId: string; amount: number }>;
  crackedEggResources: Array<{ resourceType: string; amount: number }>;
};

const MYSTERY_EGG_LABELS: Record<string, string> = {
  common_mystery_egg: 'Gewöhnliches Mystery-Ei',
  uncommon_mystery_egg: 'Ungewöhnliches Mystery-Ei',
  rare_mystery_egg: 'Seltenes Mystery-Ei'
};

const EGG_RESOURCE_LABELS: Record<string, string> = {
  cracked_eggs: 'Aufgebrochene Eier'
};

function formatMysteryEggType(eggTypeId: string): string {
  return MYSTERY_EGG_LABELS[eggTypeId] ?? eggTypeId;
}

function formatEggResourceType(resourceType: string): string {
  return EGG_RESOURCE_LABELS[resourceType] ?? resourceType;
}

export function App(): JSX.Element {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inventoryJson, setInventoryJson] = useState<string>('');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [adminHealthIssue, setAdminHealthIssue] = useState<AdminHealthIssue | null>(null);
  const [playerInventory, setPlayerInventory] = useState<PlayerInventory | null>(null);
  const [eventSubFeed, setEventSubFeed] = useState<EventSubFeedItem[]>([]);
  const [eventSubSubscriptionStatus, setEventSubSubscriptionStatus] = useState<EventSubSubscriptionStatus | null>(null);
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

  async function loadAdminHealth(): Promise<void> {
    const response = await fetch('/api/admin/health', { credentials: 'include' });
    if (response.ok) {
      setAdminHealthIssue(null);
      return;
    }
    const payload = (await response.json().catch(() => null)) as AdminHealthIssue | null;
    if (payload?.code) {
      setAdminHealthIssue(payload);
    }
  }

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    if (isAdminRoute && me?.authenticated) {
      void loadUsers(query);
      void loadAdminHealth();
      void loadEventSubFeed();
      void loadEventSubSubscriptionStatus();
    }
  }, [isAdminRoute, me?.authenticated]);

  useEffect(() => {
    if (isAdminRoute || !me?.authenticated) {
      setPlayerInventory(null);
      return;
    }

    const source = new EventSource('/api/game/inventory/stream', { withCredentials: true });
    source.addEventListener('inventory', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { inventory: PlayerInventory };
      setPlayerInventory(payload.inventory);
    });

    source.onerror = () => {
      source.close();
    };

    return () => source.close();
  }, [isAdminRoute, me?.authenticated]);


  async function identifyMysteryEgg(eggTypeId: string): Promise<void> {
    const response = await fetch('/api/game/mystery-eggs/identify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eggTypeId })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? 'Mystery-Ei konnte nicht bestimmt werden.');
    }
  }

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

  async function grantTestEgg(userId: string, eggTypeId: 'common_mystery_egg' | 'uncommon_mystery_egg' | 'rare_mystery_egg'): Promise<void> {
    const response = await fetch(`/api/admin/users/${userId}/grant-test-mystery-egg`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), eggTypeId, amount: 1 })
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


  async function loadEventSubFeed(): Promise<void> {
    const response = await fetch('/api/admin/debug/eventsubs', { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { events: EventSubFeedItem[] };
    setEventSubFeed(payload.events);
  }


  async function loadEventSubSubscriptionStatus(refresh = false): Promise<void> {
    const response = await fetch(`/api/admin/debug/eventsub-subscription${refresh ? '?refresh=true' : ''}`, { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as EventSubSubscriptionStatus;
    setEventSubSubscriptionStatus(payload);
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
          {adminHealthIssue?.code === 'NO_ACTIVE_EGG_TYPES' ? (
            <p role="alert"><strong>⚠ Konfigurationsfehler:</strong> Keine aktiven Ei-Typen vorhanden. Bitte Migration + Seed ausführen.</p>
          ) : null}
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
                <button onClick={() => void grantTestEgg(selected.id, 'common_mystery_egg')}>Gewöhnliches Test-Mystery-Ei</button>
                <button onClick={() => void grantTestEgg(selected.id, 'uncommon_mystery_egg')}>Ungewöhnliches Test-Mystery-Ei</button>
                <button onClick={() => void grantTestEgg(selected.id, 'rare_mystery_egg')}>Seltenes Test-Mystery-Ei</button>
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
          <h2>Debug: EventSub Subscription Status</h2>
          <button onClick={() => void loadEventSubSubscriptionStatus(true)}>Status aktualisieren</button>
          {eventSubSubscriptionStatus ? (
            <>
              <p>
                Status:{' '}
                {eventSubSubscriptionStatus.status === 'enabled'
                  ? '✅ Aktiviert'
                  : eventSubSubscriptionStatus.status === 'pending_verification' || eventSubSubscriptionStatus.status === 'duplicate'
                    ? '⚠ Ausstehend / Mehrdeutig'
                    : '❌ Nicht eingerichtet / Fehler'}
              </p>
              <p>Typ: {eventSubSubscriptionStatus.type}</p>
              <p>Subscription ID: {eventSubSubscriptionStatus.subscriptionId ?? '—'}</p>
              <p>Callback: {eventSubSubscriptionStatus.callback}</p>
              <p>Erstellt: {eventSubSubscriptionStatus.createdAt ? new Date(eventSubSubscriptionStatus.createdAt).toLocaleString() : '—'}</p>
              <p>Letzte Prüfung: {new Date(eventSubSubscriptionStatus.lastCheckedAt).toLocaleString()}</p>
              {eventSubSubscriptionStatus.error ? <p>Fehler: {eventSubSubscriptionStatus.error}</p> : null}
            </>
          ) : <p>Kein Status geladen.</p>}
        </section>

        <section className="card">
          <h2>Debug: Twitch EventSub Feed (letzte 25)</h2>
          <button onClick={() => void loadEventSubFeed()}>Feed aktualisieren</button>
          <ul>
            {eventSubFeed.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong> · {new Date(event.receivedAt).toLocaleString()} · Status: {event.processingStatus}
                <div>Event ID: {event.twitchEventId}</div>
                <div>Quelle: {event.source}</div>
                {event.processedAt ? <div>Verarbeitet: {new Date(event.processedAt).toLocaleString()}</div> : null}
                {event.error ? <div>Fehler: {event.error}</div> : null}
              </li>
            ))}
          </ul>
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
          <>
            <p>Dein Inventar wird automatisch aktualisiert.</p>
            {playerInventory ? (
              <>
                <p><strong>Mystery-Eier:</strong> {playerInventory.mysteryEggs.reduce((sum, entry) => sum + entry.amount, 0)}</p>
                {playerInventory.mysteryEggs
                  .filter((entry) => entry.amount > 0)
                  .map((entry) => (
                    <p key={entry.eggTypeId}>
                      <strong>{formatMysteryEggType(entry.eggTypeId)}:</strong> {entry.amount}{' '}
                      <button type="button" onClick={() => void identifyMysteryEgg(entry.eggTypeId)}>Typ bestimmen</button>
                    </p>
                  ))}
                <p><strong>Unausgebrütete Eier:</strong> {playerInventory.unhatchedEggs.length}</p>
                {playerInventory.unhatchedEggs.length > 0 ? (
                  <ul>
                    {playerInventory.unhatchedEggs.map((egg) => (
                      <li key={egg.id}>{formatMysteryEggType(egg.eggTypeId)}</li>
                    ))}
                  </ul>
                ) : <p>Keine unausgebrüteten Eier vorhanden.</p>}
                <p><strong>Geschlüpfte Pets:</strong> {playerInventory.hatchedPets.length}</p>
                {playerInventory.hatchedPets.length > 0 ? (
                  <ul>
                    {playerInventory.hatchedPets.map((pet) => (
                      <li key={pet.id}>{pet.petTypeId}</li>
                    ))}
                  </ul>
                ) : <p>Noch keine geschlüpften Pets vorhanden.</p>}
                <p><strong>Ei-Ressourcen:</strong> {playerInventory.crackedEggResources.reduce((sum, entry) => sum + entry.amount, 0)}</p>
                {playerInventory.crackedEggResources
                  .filter((entry) => entry.amount > 0)
                  .map((entry) => (
                    <p key={entry.resourceType}><strong>{formatEggResourceType(entry.resourceType)}:</strong> {entry.amount}</p>
                  ))}
              </>
            ) : <p>Inventar wird geladen…</p>}
          </>
        ) : (
          <p>Nach dem Login siehst du hier deinen Spielbereich.</p>
        )}
      </section>
    </main>
  );
}
