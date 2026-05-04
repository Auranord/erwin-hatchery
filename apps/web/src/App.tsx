import { useEffect, useMemo, useState } from 'react';

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
type BattleEvent = {
  id: string;
  status: string;
  resultJson: unknown;
  createdAt: string;
  revertedAt: string | null;
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


type TwitchCustomReward = {
  id: string;
  name: string;
  description: string;
  cost: number;
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
  hatchedPets: Array<{
    id: string;
    petTypeId: string;
    petTypeDisplayName: string;
    rarity: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    selectedForEvent: boolean;
    createdAt: string;
  }>;
  consumables: Array<{ consumableTypeId: string; amount: number }>;
  crackedEggResources: Array<{ resourceType: string; amount: number }>;
  incubatorSlots: Array<{ id: string; slotSource: string; isAvailable: boolean; activeJob: { id: string; unhatchedEggId: string; state: string; startedAt: string; requiredProgressSeconds: number } | null }>;
};


type OverlayHatchAlert = { userName: string; petName: string; createdAt: string };
type OverlayBattleWinner = { placement: number; userName: string; petName: string; pointsAwarded: number };

type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string | null;
  login: string | null;
  score: number;
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

function formatRemainingDuration(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function App(): JSX.Element {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inventoryJson, setInventoryJson] = useState<string>('');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [adminHealthIssue, setAdminHealthIssue] = useState<AdminHealthIssue | null>(null);
  const [playerInventory, setPlayerInventory] = useState<PlayerInventory | null>(null);
  const [eventSubFeed, setEventSubFeed] = useState<EventSubFeedItem[]>([]);
  const [eventSubSubscriptionStatus, setEventSubSubscriptionStatus] = useState<EventSubSubscriptionStatus | null>(null);
  const [twitchCustomRewards, setTwitchCustomRewards] = useState<TwitchCustomReward[]>([]);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const isAdminRoute = window.location.pathname.startsWith('/admin');
  const isAlertOverlayRoute = window.location.pathname === '/overlay/alerts';
  const isBattleOverlayRoute = window.location.pathname === '/overlay/battle';
  const [overlayAlerts, setOverlayAlerts] = useState<OverlayHatchAlert[]>([]);
  const [battleWinners, setBattleWinners] = useState<OverlayBattleWinner[]>([]);

  const activeIncubationByEggId = useMemo(() => {
    if (!playerInventory) return new Map<string, { startedAt: string; requiredProgressSeconds: number }>();
    return new Map(
      playerInventory.incubatorSlots
        .filter((slot) => slot.activeJob)
        .map((slot) => [
          slot.activeJob!.unhatchedEggId,
          { startedAt: slot.activeJob!.startedAt, requiredProgressSeconds: slot.activeJob!.requiredProgressSeconds }
        ])
    );
  }, [playerInventory]);

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

  async function loadLeaderboard(): Promise<void> {
    const response = await fetch('/api/game/leaderboard', { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { entries?: LeaderboardEntry[] };
    setLeaderboardEntries(payload.entries ?? []);
  }

  useEffect(() => {
    void loadMe();
    void loadLeaderboard();
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
    if (isAdminRoute || !me?.authenticated || !playerInventory) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isAdminRoute, me?.authenticated, playerInventory]);

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



  async function refreshOwnInventory(): Promise<void> {
    const response = await fetch('/api/game/inventory', { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { inventory: PlayerInventory };
    setPlayerInventory(payload.inventory);
  }

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

  async function startIncubation(unhatchedEggId: string, incubatorSlotId: string): Promise<void> {
    const response = await fetch('/api/game/incubation/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unhatchedEggId, incubatorSlotId })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? 'Inkubation konnte nicht gestartet werden.');
    }
  }

  async function finishIncubation(unhatchedEggId: string): Promise<void> {
    const response = await fetch('/api/game/incubation/finish', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unhatchedEggId })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? 'Inkubation konnte nicht abgeschlossen werden.');
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

  async function grantIncubatorSlot(userId: string): Promise<void> {
    const response = await fetch(`/api/admin/users/${userId}/grant-incubator-slot`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID() })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? 'Inkubator-Slot konnte nicht vergeben werden.');
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




  async function loadTwitchCustomRewards(): Promise<void> {
    const response = await fetch('/api/admin/twitch/custom-rewards', { credentials: 'include' });
    const payload = (await response.json().catch(() => null)) as { rewards?: TwitchCustomReward[]; message?: string } | null;
    if (!response.ok) {
      window.alert(payload?.message ?? 'Twitch Custom Rewards konnten nicht geladen werden.');
      return;
    }
    setTwitchCustomRewards(payload?.rewards ?? []);
  }

  async function syncTwitchCustomRewards(): Promise<void> {
    const response = await fetch('/api/admin/twitch/custom-rewards/sync', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID() })
    });
    const payload = (await response.json().catch(() => null)) as { message?: string; created?: number; updated?: number; total?: number } | null;
    if (!response.ok) {
      window.alert(payload?.message ?? 'Twitch-Reward-Sync fehlgeschlagen.');
      return;
    }
    window.alert(`Twitch-Reward-Sync abgeschlossen. Neu: ${payload?.created ?? 0}, aktualisiert: ${payload?.updated ?? 0}, Ei-Typen: ${payload?.total ?? 0}.`);
  }

  async function loadLedger(userId?: string): Promise<void> {
    const response = await fetch(`/api/admin/ledger${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { entries: LedgerEntry[] };
    setLedgerEntries(payload.entries);
  }


  async function toggleEventPetSelection(petId: string, selectedForEvent: boolean): Promise<void> {
    const response = await fetch(`/api/game/pets/${petId}/selection`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedForEvent })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      window.alert(payload?.message ?? 'Event-Pet konnte nicht aktualisiert werden.');
      return;
    }

    await refreshOwnInventory();
  }


  async function startBattleEvent(): Promise<void> {
    const response = await fetch('/api/admin/events/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID() })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      window.alert(payload?.message ?? 'Event konnte nicht gestartet werden.');
      return;
    }
    await loadLedger();
    await loadBattleEvents();
    window.alert('Event erfolgreich gestartet.');
  }

  async function loadBattleEvents(): Promise<void> {
    const response = await fetch('/api/admin/events', { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { events: BattleEvent[] };
    setBattleEvents(payload.events);
  }

  async function revertBattleEvent(eventId: string): Promise<void> {
    const response = await fetch(`/api/admin/events/${eventId}/revert`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID() })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      window.alert(payload?.message ?? 'Battle-Event konnte nicht revertiert werden.');
      return;
    }
    await loadBattleEvents();
    await loadLedger();
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

  async function copyOverlaySource(type: 'alerts' | 'battle'): Promise<void> {
    const path = type === 'alerts' ? '/overlay/alerts' : '/overlay/battle';
    const sourceUrl = `${window.location.origin}${path}`;

    try {
      await navigator.clipboard.writeText(sourceUrl);
      window.alert(`OBS-Overlay-Link kopiert: ${sourceUrl}`);
    } catch {
      window.alert(`Kopieren fehlgeschlagen. Bitte manuell kopieren:\n${sourceUrl}`);
    }
  }


  useEffect(() => {
    if (!isAlertOverlayRoute) return;
    const source = new EventSource('/api/events/overlay/alerts/stream');
    source.addEventListener('hatch_alert', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as OverlayHatchAlert;
      setOverlayAlerts((current) => [payload, ...current].slice(0, 5));
    });
    source.onerror = () => source.close();
    return () => source.close();
  }, [isAlertOverlayRoute]);

  useEffect(() => {
    if (!isBattleOverlayRoute) return;
    fetch('/api/events/overlay/battle').then(async (response) => {
      if (!response.ok) return;
      const payload = (await response.json()) as { winners: OverlayBattleWinner[] };
      setBattleWinners(payload.winners ?? []);
    }).catch(() => undefined);
  }, [isBattleOverlayRoute]);

  if (isAlertOverlayRoute) {
    return <main className="container"><section className="card"><h2>🐣 Hatch Alerts</h2><ul>{overlayAlerts.map((alert) => <li key={`${alert.createdAt}-${alert.userName}-${alert.petName}`}><strong>{alert.userName}</strong> hat <strong>{alert.petName}</strong> ausgebrütet!</li>)}</ul></section></main>;
  }

  if (isBattleOverlayRoute) {
    return <main className="container"><section className="card"><h2>🏆 Event Top 3</h2><ol>{battleWinners.map((winner) => <li key={`${winner.placement}-${winner.userName}-${winner.petName}`}>Platz {winner.placement}: <strong>{winner.userName}</strong> mit <strong>{winner.petName}</strong> (+{winner.pointsAwarded})</li>)}</ol></section></main>;
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
          <button onClick={() => void startBattleEvent()}>Stream-Event starten (3 zufällige Pets)</button>
          <button onClick={() => void loadBattleEvents()}>Battle-Events laden</button>
          <div>
            <button onClick={() => void copyOverlaySource('alerts')}>OBS-Link kopieren: Hatch Alerts</button>
            <button onClick={() => void copyOverlaySource('battle')}>OBS-Link kopieren: Battle Top 3</button>
          </div>
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
          <h2>Battle-Events</h2>
          <ul>
            {battleEvents.map((event) => (
              <li key={event.id}>
                <strong>{event.status}</strong> · {new Date(event.createdAt).toLocaleString()}
                <button disabled={event.status === 'reverted'} onClick={() => void revertBattleEvent(event.id)}>Battle revertieren</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Redemption-Verwaltung</h2>
          <p>Verwaltung und Übersicht der Twitch Custom Rewards.</p>
          <div>
            <button onClick={() => void syncTwitchCustomRewards()}>Twitch Custom Rewards mit Ei-Typen synchronisieren</button>
            <button onClick={() => void loadTwitchCustomRewards()}>Alle Custom Rewards laden</button>
          </div>
          {twitchCustomRewards.length > 0 ? (
            <ul>
              {twitchCustomRewards.map((reward) => (
                <li key={reward.id}>
                  <strong>{reward.name}</strong>
                  <div>ID: {reward.id}</div>
                  <div>Beschreibung: {reward.description || '—'}</div>
                  <div>Kosten: {reward.cost}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p>Noch keine Rewards geladen.</p>
          )}
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
                <button onClick={() => void grantIncubatorSlot(selected.id)}>Inkubator-Slot +1</button>
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
        <h2>Globales Leaderboard</h2>
        <p>Top 10 Spieler nach Event-Punkten.</p>
        {leaderboardEntries.length > 0 ? (
          <ol>
            {leaderboardEntries.map((entry) => (
              <li key={entry.userId}>
                <strong>{entry.displayName ?? entry.login ?? `Spieler ${entry.rank}`}</strong> · {entry.score} Punkte
              </li>
            ))}
          </ol>
        ) : (
          <p>Noch keine Event-Punkte vorhanden.</p>
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
                <p><strong>Inkubator-Slots:</strong> {playerInventory.incubatorSlots.length}</p>
                {playerInventory.unhatchedEggs.length > 0 ? (
                  <ul>
                    {playerInventory.unhatchedEggs.map((egg) => (
                      <li key={egg.id}>
                        {formatMysteryEggType(egg.eggTypeId)} ({egg.state}){' '}
                        {egg.state === 'incubating' && activeIncubationByEggId.has(egg.id)
                          ? (() => {
                              const activeIncubation = activeIncubationByEggId.get(egg.id)!;
                              const hatchAtMs = new Date(activeIncubation.startedAt).getTime() + (activeIncubation.requiredProgressSeconds * 1000);
                              const secondsRemaining = Math.ceil((hatchAtMs - nowMs) / 1000);
                              return (
                                <>
                                  <strong>· Verbleibend: {formatRemainingDuration(secondsRemaining)}</strong>{' '}
                                  {secondsRemaining <= 0 ? (
                                    <button type="button" onClick={() => void finishIncubation(egg.id)}>
                                      Ausbrüten abschließen
                                    </button>
                                  ) : null}
                                </>
                              );
                            })()
                          : null}
                        {egg.state === 'ready_for_incubation'
                          ? (
                            <button
                              type="button"
                              onClick={() => {
                                const freeSlot = playerInventory.incubatorSlots.find((slot) => slot.isAvailable && !slot.activeJob);
                                if (freeSlot) {
                                  void startIncubation(egg.id, freeSlot.id);
                                }
                              }}
                              disabled={!playerInventory.incubatorSlots.some((slot) => slot.isAvailable && !slot.activeJob)}
                            >
                              In Inkubator legen
                            </button>
                            )
                          : null}
                      </li>
                    ))}
                  </ul>
                ) : <p>Keine unausgebrüteten Eier vorhanden.</p>}
                <p><strong>Geschlüpfte Pets:</strong> {playerInventory.hatchedPets.length}</p>
                {playerInventory.hatchedPets.length > 0 ? (
                  <ul>
                    {playerInventory.hatchedPets.map((pet) => (
                      <li key={pet.id} className={pet.selectedForEvent ? 'selected-pet' : undefined}>
                        <strong>{pet.petTypeDisplayName}</strong> ({pet.rarity} · {pet.role})
                        <br />
                        HP {pet.hp} · ATK {pet.attack} · DEF {pet.defense} · SPD {pet.speed}
                        <br />
                        <button
                          className={pet.selectedForEvent ? 'selected-pet-button' : undefined}
                          type="button"
                          onClick={() => {
                            const shouldSelect = !pet.selectedForEvent;
                            void toggleEventPetSelection(pet.id, shouldSelect);
                          }}
                        >
                          {pet.selectedForEvent ? 'Für Event ausgewählt' : 'Für Event auswählen'}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p>Noch keine geschlüpften Pets vorhanden.</p>}
                <p>
                  <strong>Event-Pet:</strong>{' '}
                  {playerInventory.hatchedPets.filter((pet) => pet.selectedForEvent).map((pet) => pet.petTypeDisplayName).join(', ') || 'Kein Pet ausgewählt'}
                </p>
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
