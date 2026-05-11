import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent
} from 'react';

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
  isSubscriber: boolean;
  subscriberEndsAt: string | null;
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
  status:
    | 'enabled'
    | 'missing'
    | 'error'
    | 'duplicate'
    | 'pending_verification';
  subscriptionId: string | null;
  type: string;
  callback: string;
  createdAt: string | null;
  lastCheckedAt: string;
  error: string | null;
};

type GridDimensions = {
  kind: string;
  columns: number;
  rows: number;
  baseRows: number;
  bonusRows: number;
  capacity: number;
  upgradeRef: string | null;
};
type GridCell<T> = { slotIndex: number; item: T | null };
type InventoryGrid<T> = {
  dimensions: GridDimensions;
  slots: Array<GridCell<T>>;
};
type IncubatorInventory = { incubators: IncubatorItem[] };
type IncubatorItem = {
  id: string;
  slotSource: string;
  slotLevel: number;
  slotIndex: number | null;
  isAvailable: boolean;
  metadata: {
    speedMultiplierBasisPoints: number;
    specialBonusBasisPoints: number;
    fuelBehavior: string;
    specialEffectConfig: unknown;
  };
  activeJob: {
    id: string;
    unhatchedEggId: string;
    state: string;
    startedAt: string;
    requiredProgressSeconds: number;
    progressSecondsAccumulated: number;
    lastProgressedAt: string | null;
    progressSnapshot?: unknown;
  } | null;
};
type EggItem = { id: string; eggTypeId: string; state: string };
type PetTrait = {
  id: string;
  labelDe: string;
  description: string;
  hpModifier: number;
  atkModifier: number;
  defModifier: number;
  spdModifier: number;
  gainModifier: number;
  powModifier: number;
};
type PetItem = {
  id: string;
  speciesId: string;
  speciesDisplayName: string;
  rarityId: string;
  rarityLabelDe: string;
  classId: string;
  classLabelDe: string;
  elementId: string;
  elementLabelDe: string;
  abilityId: string;
  abilityLabelDe: string;
  nickname: string | null;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  baseGain: number;
  basePow: number;
  experience: number;
  level: number;
  isFavorite: boolean;
  equippedHatId: string | null;
  traits: PetTrait[];
  selectedForEvent: boolean;
  createdAt: string;
};
type ConsumableItem = {
  id: string;
  consumableTypeId: string;
  quantity: number;
};
type EquipmentItem = { id: string; equipmentTypeId: string };
type EquipmentSetSlot = { slotIndex: number; item: EquipmentItem | null };
type EquipmentSet = {
  id: string;
  setIndex: number;
  label: string;
  baseSlotCount: number;
  bonusSlotCount: number;
  slotCount: number;
  selectedForEvent: boolean;
  upgradeRef: string | null;
  slots: EquipmentSetSlot[];
};
type HatItem = { id: string; hatId: string };
type PlayerInventory = {
  mysteryEggs: Array<{ eggTypeId: string; amount: number }>;
  crackedEggResources: Array<{ resourceType: string; amount: number }>;
  incubators: IncubatorInventory;
  unhatchedEggs: InventoryGrid<EggItem>;
  pets: InventoryGrid<PetItem>;
  consumables: InventoryGrid<ConsumableItem>;
  equipment: InventoryGrid<EquipmentItem>;
  equipmentSets: EquipmentSet[];
  hats: InventoryGrid<HatItem>;
};
type DragPayload =
  | { kind: 'incubator'; id: string }
  | { kind: 'egg'; id: string }
  | { kind: 'pet'; id: string }
  | { kind: 'consumable'; id: string }
  | { kind: 'equipment'; id: string }
  | { kind: 'equipment-set'; id: string }
  | { kind: 'hat'; id: string };
type PetScrapTarget = { petId: string; label: string; rarity: string };
type InventoryDiscardKind = 'egg' | 'consumable' | 'equipment' | 'hat';
type InventoryDiscardTarget = {
  kind: InventoryDiscardKind;
  id: string;
  label: string;
};

type OverlayAlertEvent = {
  id: string;
  type: string;
  title: string;
  message: string;
  accent: 'hatch' | 'battle' | 'system';
  createdAt: string;
  durationMs: number;
};
type OverlayBattleWinner = {
  placement: number;
  userName: string;
  petName: string;
  pointsAwarded: number;
};
type OverlayEventLeader = { rank: number; userName: string; points: number };

type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string | null;
  login: string | null;
  score: number;
};


type SlotAssetFolder = 'eggs' | 'pets' | 'consumables' | 'equipment' | 'hats';

type SlotAssetProps = {
  folder: SlotAssetFolder;
  assetKey: string;
  label: string;
  size: 28 | 56 | 112;
  className?: string;
};

const SLOT_ASSET_ROOT = '/assets/slots';

function getSlotAssetPath(
  folder: SlotAssetFolder,
  assetKey: string,
  size: 28 | 56 | 112
): string {
  return `${SLOT_ASSET_ROOT}/${folder}/${assetKey}-${size}.png`;
}

function getSlotFallbackAssetPath(
  folder: SlotAssetFolder,
  size: 28 | 56 | 112
): string {
  return getSlotAssetPath(folder, 'fallback', size);
}

function fallbackSlotAsset(
  event: SyntheticEvent<HTMLImageElement>,
  folder: SlotAssetFolder,
  size: 28 | 56 | 112
): void {
  const image = event.currentTarget;
  const fallbackSrc = getSlotFallbackAssetPath(folder, size);
  if (image.getAttribute('src') === fallbackSrc) return;
  image.src = fallbackSrc;
}

function renderSlotAsset({
  folder,
  assetKey,
  label,
  size,
  className = ''
}: SlotAssetProps): JSX.Element {
  return (
    <img
      src={getSlotAssetPath(folder, assetKey, size)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`slot-asset slot-asset--${size} ${className}`.trim()}
      onError={(event) => fallbackSlotAsset(event, folder, size)}
      title={label}
      width={size}
      height={size}
    />
  );
}

function getEggAssetKey(eggTypeId: string): string {
  return eggTypeId;
}

function getPetAssetKey(speciesId: string): string {
  return `pet_${speciesId}`;
}

const MYSTERY_EGG_LABELS: Record<string, string> = {
  beta_egg: 'Beta Ei'
};

const EGG_RESOURCE_LABELS: Record<string, string> = {
  cracked_eggs: 'Aufgebrochene Eier',
  voucher: 'Gutschein'
};

function formatMysteryEggType(eggTypeId: string): string {
  return MYSTERY_EGG_LABELS[eggTypeId] ?? eggTypeId;
}

function formatEggResourceType(resourceType: string): string {
  return EGG_RESOURCE_LABELS[resourceType] ?? resourceType;
}

function formatIncubatorSource(slotSource: string): string {
  if (slotSource === 'default') return 'Standard-Inkubator';
  if (slotSource === 'upgrade') return 'Upgrade-Inkubator';
  return slotSource;
}

function toCssModifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function getPetRarityClassName(rarityId: string): string {
  return `pet-rarity-${toCssModifier(rarityId)}`;
}

function getEmblemAssetPath(assetPath: string): string {
  return `${SLOT_ASSET_ROOT}/emblems/${assetPath}-16.png`;
}

function hideBrokenEmblemAsset(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.hidden = true;
}

function renderEmblemAsset(
  assetPath: string,
  label: string,
  className = ''
): JSX.Element {
  return (
    <img
      src={getEmblemAssetPath(assetPath)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`pet-emblem-asset ${className}`.trim()}
      onError={hideBrokenEmblemAsset}
      title={label}
      width={16}
      height={16}
    />
  );
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
  const [adminHealthIssue, setAdminHealthIssue] =
    useState<AdminHealthIssue | null>(null);
  const [playerInventory, setPlayerInventory] =
    useState<PlayerInventory | null>(null);
  const [eventSubFeed, setEventSubFeed] = useState<EventSubFeedItem[]>([]);
  const [eventSubSubscriptionStatus, setEventSubSubscriptionStatus] =
    useState<EventSubSubscriptionStatus | null>(null);
  const [twitchCustomRewards, setTwitchCustomRewards] = useState<
    TwitchCustomReward[]
  >([]);
  const [leaderboardEntries, setLeaderboardEntries] = useState<
    LeaderboardEntry[]
  >([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [selectedPayload, setSelectedPayload] = useState<DragPayload | null>(
    null
  );
  const [pendingPetScrap, setPendingPetScrap] = useState<PetScrapTarget | null>(
    null
  );
  const [isPetScrapSubmitting, setIsPetScrapSubmitting] = useState(false);
  const [pendingInventoryDiscard, setPendingInventoryDiscard] =
    useState<InventoryDiscardTarget | null>(null);
  const [isInventoryDiscardSubmitting, setIsInventoryDiscardSubmitting] =
    useState(false);
  const petScrapConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [gameMessage, setGameMessage] = useState<string | null>(null);
  const isAdminRoute = window.location.pathname.startsWith('/admin');
  const isAlertOverlayRoute = window.location.pathname === '/overlay/alerts';
  const isBattleOverlayRoute = window.location.pathname === '/overlay/battle';
  const [overlayAlertQueue, setOverlayAlertQueue] = useState<
    OverlayAlertEvent[]
  >([]);
  const [battleWinners, setBattleWinners] = useState<OverlayBattleWinner[]>([]);
  const [overlayLeaders, setOverlayLeaders] = useState<OverlayEventLeader[]>(
    []
  );

  async function loadMe(): Promise<void> {
    const response = await fetch('/api/me', { credentials: 'include' });
    setMe((await response.json()) as MeResponse);
  }

  async function loadUsers(search = ''): Promise<void> {
    const response = await fetch(
      `/api/admin/users?q=${encodeURIComponent(search)}`,
      { credentials: 'include' }
    );
    if (response.ok) {
      const payload = (await response.json()) as { users: AdminUser[] };
      setUsers(payload.users);
    }
  }

  async function loadAdminHealth(): Promise<void> {
    const response = await fetch('/api/admin/health', {
      credentials: 'include'
    });
    if (response.ok) {
      setAdminHealthIssue(null);
      return;
    }
    const payload = (await response
      .json()
      .catch(() => null)) as AdminHealthIssue | null;
    if (payload?.code) {
      setAdminHealthIssue(payload);
    }
  }

  async function loadLeaderboard(): Promise<void> {
    const response = await fetch('/api/game/leaderboard', {
      credentials: 'include'
    });
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

    const source = new EventSource('/api/game/inventory/stream', {
      withCredentials: true
    });
    source.addEventListener('inventory', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        inventory: PlayerInventory;
      };
      setPlayerInventory(payload.inventory);
    });

    source.onerror = () => {
      source.close();
    };

    return () => source.close();
  }, [isAdminRoute, me?.authenticated]);

  useEffect(() => {
    if (!pendingPetScrap) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    petScrapConfirmButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPetScrapSubmitting) {
        setPendingPetScrap(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPetScrapSubmitting, pendingPetScrap]);

  async function refreshOwnInventory(): Promise<void> {
    const response = await fetch('/api/game/inventory', {
      credentials: 'include'
    });
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
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Mystery-Ei konnte nicht bestimmt werden.'
      );
    }
  }

  async function startIncubation(
    unhatchedEggId: string,
    incubatorSlotId: string
  ): Promise<void> {
    const response = await fetch('/api/game/incubation/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unhatchedEggId, incubatorSlotId })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Inkubation konnte nicht gestartet werden.'
      );
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
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Inkubation konnte nicht abgeschlossen werden.'
      );
    }
  }

  async function scrapPet(petId: string): Promise<void> {
    const response = await fetch('/api/game/pets/scrap', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ petId, confirm: true })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(payload?.message ?? 'Pet konnte nicht verwertet werden.');
    }
  }

  async function postInventoryAction(
    endpoint: string,
    payload: Record<string, string | number | boolean>
  ): Promise<void> {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const responsePayload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        responsePayload?.message ?? 'Inventar-Aktion fehlgeschlagen.'
      );
    }
    await refreshOwnInventory();
  }

  async function postInventoryMove(
    endpoint: string,
    payload: Record<string, string | number | boolean>
  ): Promise<void> {
    await postInventoryAction(endpoint, payload);
  }

  async function discardInventoryItem(
    target: InventoryDiscardTarget
  ): Promise<void> {
    const endpointByKind: Record<InventoryDiscardKind, string> = {
      egg: '/api/game/inventory/egg-slots/discard',
      consumable: '/api/game/inventory/consumable-slots/discard',
      equipment: '/api/game/inventory/equipment-slots/discard',
      hat: '/api/game/inventory/hat-slots/discard'
    };
    const idKeyByKind: Record<InventoryDiscardKind, string> = {
      egg: 'unhatchedEggId',
      consumable: 'consumableSlotId',
      equipment: 'equipmentSlotId',
      hat: 'hatSlotId'
    };
    await postInventoryAction(endpointByKind[target.kind], {
      [idKeyByKind[target.kind]]: target.id,
      confirm: true
    });
  }

  function isInventoryDiscardKind(
    kind: DragPayload['kind']
  ): kind is InventoryDiscardKind {
    return (
      kind === 'egg' ||
      kind === 'consumable' ||
      kind === 'equipment' ||
      kind === 'hat'
    );
  }

  function getInventoryDiscardLabel(payload: {
    kind: InventoryDiscardKind;
    id: string;
  }): string {
    if (payload.kind === 'egg') {
      const egg = playerInventory?.unhatchedEggs.slots
        .map((cell) => cell.item)
        .find((item): item is EggItem => item?.id === payload.id);
      return egg ? formatMysteryEggType(egg.eggTypeId) : 'dieses Ei';
    }
    if (payload.kind === 'consumable') {
      const consumable = playerInventory?.consumables.slots
        .map((cell) => cell.item)
        .find((item): item is ConsumableItem => item?.id === payload.id);
      return consumable?.consumableTypeId ?? 'dieses Verbrauchbare';
    }
    if (payload.kind === 'equipment') {
      const equipment = playerInventory?.equipment.slots
        .map((cell) => cell.item)
        .find((item): item is EquipmentItem => item?.id === payload.id);
      return equipment?.equipmentTypeId ?? 'diese Ausrüstung';
    }
    const hat = playerInventory?.hats.slots
      .map((cell) => cell.item)
      .find((item): item is HatItem => item?.id === payload.id);
    return hat?.hatId ?? 'diesen Hut';
  }

  function showGameError(error: unknown): void {
    setGameMessage(
      error instanceof Error ? error.message : 'Aktion fehlgeschlagen.'
    );
  }

  async function confirmPetScrap(): Promise<void> {
    if (!pendingPetScrap || isPetScrapSubmitting) return;

    setIsPetScrapSubmitting(true);
    try {
      await scrapPet(pendingPetScrap.petId);
      setPendingPetScrap(null);
      await refreshOwnInventory();
    } catch (error) {
      showGameError(error);
    } finally {
      setIsPetScrapSubmitting(false);
    }
  }

  async function confirmInventoryDiscard(): Promise<void> {
    if (!pendingInventoryDiscard || isInventoryDiscardSubmitting) return;

    setIsInventoryDiscardSubmitting(true);
    try {
      await discardInventoryItem(pendingInventoryDiscard);
      setPendingInventoryDiscard(null);
      await refreshOwnInventory();
    } catch (error) {
      showGameError(error);
    } finally {
      setIsInventoryDiscardSubmitting(false);
    }
  }

  async function handleDropToSlot(
    targetKind: 'incubator' | 'egg' | 'pet' | 'consumable' | 'equipment' | 'equipment-set' | 'hat' | 'trashcan' | 'discard',
    slotIndex: number,
    targetIncubatorId?: string
  ): Promise<void> {
    const payload = dragPayload ?? selectedPayload;
    setSelectedPayload(null);
    setDragPayload(null);
    if (!payload) return;
    try {
      if (
        payload.kind === 'egg' &&
        targetKind === 'incubator' &&
        targetIncubatorId
      ) {
        await startIncubation(payload.id, targetIncubatorId);
        await refreshOwnInventory();
        return;
      }
      if (targetKind === 'discard' && isInventoryDiscardKind(payload.kind)) {
        const discardTarget = { kind: payload.kind, id: payload.id };
        setPendingInventoryDiscard({
          ...discardTarget,
          label: getInventoryDiscardLabel(discardTarget)
        });
      } else if (payload.kind === 'pet' && targetKind === 'trashcan') {
        const pet = playerInventory?.pets.slots
          .map((cell) => cell.item)
          .find((item): item is PetItem => item?.id === payload.id);
        setPendingPetScrap({
          petId: payload.id,
          label: pet?.speciesDisplayName ?? 'dieses Pet',
          rarity: pet?.rarityLabelDe ?? 'unbekannt'
        });
      } else if (payload.kind === 'egg' && targetKind === 'egg')
        await postInventoryMove('/api/game/inventory/egg-slots/move', {
          unhatchedEggId: payload.id,
          toSlotIndex: slotIndex
        });
      else if (payload.kind === 'pet' && targetKind === 'pet')
        await postInventoryMove('/api/game/inventory/pet-slots/move', {
          petId: payload.id,
          toSlotIndex: slotIndex
        });
      else if (payload.kind === 'consumable' && targetKind === 'consumable')
        await postInventoryMove('/api/game/inventory/consumable-slots/move', {
          consumableSlotId: payload.id,
          toSlotIndex: slotIndex
        });
      else if (payload.kind === 'equipment' && targetKind === 'equipment-set')
        await postInventoryMove('/api/game/inventory/equipment-set-slots/move', {
          equipmentSlotId: payload.id,
          toEquipmentSetId: targetIncubatorId ?? '',
          toSetSlotIndex: slotIndex
        });
      else if (payload.kind === 'equipment-set' && targetKind === 'equipment-set')
        await postInventoryMove('/api/game/inventory/equipment-set-slots/move', {
          equipmentSlotId: payload.id,
          toEquipmentSetId: targetIncubatorId ?? '',
          toSetSlotIndex: slotIndex
        });
      else if (payload.kind === 'equipment-set' && targetKind === 'equipment')
        await postInventoryMove('/api/game/inventory/equipment-set-slots/move', {
          equipmentSlotId: payload.id,
          toSlotIndex: slotIndex
        });
      else if (payload.kind === 'equipment' && targetKind === 'equipment')
        await postInventoryMove('/api/game/inventory/equipment-slots/move', {
          equipmentSlotId: payload.id,
          toSlotIndex: slotIndex
        });
      else if (payload.kind === 'hat' && targetKind === 'hat')
        await postInventoryMove('/api/game/inventory/hat-slots/move', {
          hatSlotId: payload.id,
          toSlotIndex: slotIndex
        });
    } catch (error) {
      showGameError(error);
    }
  }

  function selectOrRun(
    payload: DragPayload,
    targetKind: 'incubator' | 'egg' | 'pet' | 'consumable' | 'equipment' | 'equipment-set' | 'hat' | 'trashcan' | 'discard',
    slotIndex: number,
    targetIncubatorId?: string
  ): void {
    if (selectedPayload) {
      void handleDropToSlot(targetKind, slotIndex, targetIncubatorId);
      return;
    }
    setSelectedPayload(payload);
    if (payload.kind === 'egg') {
      setGameMessage('Inkubator, Verwerfen-Slot oder Ziel-Slot antippen.');
    } else if (payload.kind === 'pet') {
      setGameMessage('Event-Slot, Verwerten-Slot oder Ziel-Slot antippen.');
    } else if (payload.kind === 'equipment' || payload.kind === 'equipment-set') {
      setGameMessage('Set-Slot, Ausrüstungsinventar oder Verwerfen-Slot antippen.');
    } else {
      setGameMessage('Verwerfen-Slot oder Ziel-Slot antippen.');
    }
  }

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    await loadMe();
  }

  async function changeRole(
    userId: string,
    role: Role,
    action: 'grant' | 'revoke'
  ): Promise<void> {
    await fetch(`/api/admin/users/${userId}/role`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, action, requestId: crypto.randomUUID() })
    });
    await loadUsers(query);
  }

  async function grantTestEgg(
    userId: string,
    eggTypeId: 'beta_egg'
  ): Promise<void> {
    const response = await fetch(
      `/api/admin/users/${userId}/grant-test-mystery-egg`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          eggTypeId,
          amount: 1
        })
      }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Test-Mystery-Ei konnte nicht vergeben werden.'
      );
    }
    await loadInventory(userId);
    await loadLedger(userId);
  }

  async function loadInventory(userId: string): Promise<void> {
    const response = await fetch(`/api/admin/users/${userId}/inventory`, {
      credentials: 'include'
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { inventory: unknown };
    setInventoryJson(JSON.stringify(payload.inventory, null, 2));
  }

  async function loadEventSubFeed(): Promise<void> {
    const response = await fetch('/api/admin/debug/eventsubs', {
      credentials: 'include'
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { events: EventSubFeedItem[] };
    setEventSubFeed(payload.events);
  }

  async function loadEventSubSubscriptionStatus(
    refresh = false
  ): Promise<void> {
    const response = await fetch(
      `/api/admin/debug/eventsub-subscription${refresh ? '?refresh=true' : ''}`,
      { credentials: 'include' }
    );
    if (!response.ok) return;
    const payload = (await response.json()) as EventSubSubscriptionStatus;
    setEventSubSubscriptionStatus(payload);
  }

  async function loadTwitchCustomRewards(): Promise<void> {
    const response = await fetch('/api/admin/twitch/custom-rewards', {
      credentials: 'include'
    });
    const payload = (await response.json().catch(() => null)) as {
      rewards?: TwitchCustomReward[];
      message?: string;
    } | null;
    if (!response.ok) {
      window.alert(
        payload?.message ??
          'Twitch Custom Rewards konnten nicht geladen werden.'
      );
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
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      created?: number;
      updated?: number;
      total?: number;
    } | null;
    if (!response.ok) {
      window.alert(payload?.message ?? 'Twitch-Reward-Sync fehlgeschlagen.');
      return;
    }
    window.alert(
      `Twitch-Reward-Sync abgeschlossen. Neu: ${payload?.created ?? 0}, aktualisiert: ${payload?.updated ?? 0}, Ei-Typen: ${payload?.total ?? 0}.`
    );
  }

  async function loadLedger(userId?: string): Promise<void> {
    const response = await fetch(
      `/api/admin/ledger${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`,
      { credentials: 'include' }
    );
    if (!response.ok) return;
    const payload = (await response.json()) as { entries: LedgerEntry[] };
    setLedgerEntries(payload.entries);
  }

  async function setEventPetSelection(
    petId: string,
    selectedForEvent: boolean
  ): Promise<void> {
    const response = await fetch(`/api/game/pets/${petId}/selection`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedForEvent })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Event-Pet konnte nicht aktualisiert werden.'
      );
    }
  }

  async function setPetFavorite(
    petId: string,
    isFavorite: boolean
  ): Promise<void> {
    const response = await fetch(`/api/game/pets/${petId}/favorite`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Favorit konnte nicht aktualisiert werden.'
      );
    }
  }

  async function handlePetFavoriteToggle(
    petId: string,
    isFavorite: boolean
  ): Promise<void> {
    try {
      await setPetFavorite(petId, isFavorite);
      await refreshOwnInventory();
      setGameMessage(
        isFavorite
          ? 'Pet als Favorit markiert.'
          : 'Pet ist kein Favorit mehr.'
      );
    } catch (error) {
      showGameError(error);
    }
  }

  async function handleDropToEventPetSlot(): Promise<void> {
    const payload = dragPayload ?? selectedPayload;
    setSelectedPayload(null);
    setDragPayload(null);
    if (!payload || payload.kind !== 'pet') return;

    try {
      await setEventPetSelection(payload.id, true);
      await refreshOwnInventory();
      setGameMessage('Event-Pet ausgewählt.');
    } catch (error) {
      showGameError(error);
    }
  }

  async function handleDeselectEventPet(petId: string): Promise<void> {
    try {
      await setEventPetSelection(petId, false);
      await refreshOwnInventory();
      setGameMessage('Event-Pet abgewählt.');
    } catch (error) {
      showGameError(error);
    }
  }

  async function setEventEquipmentSetSelection(
    setId: string,
    selectedForEvent: boolean
  ): Promise<void> {
    const response = await fetch(`/api/game/equipment-sets/${setId}/selection`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedForEvent })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Event-Set konnte nicht aktualisiert werden.'
      );
    }
  }

  async function handleEventEquipmentSetSelection(
    setId: string,
    selectedForEvent: boolean
  ): Promise<void> {
    try {
      await setEventEquipmentSetSelection(setId, selectedForEvent);
      await refreshOwnInventory();
      setGameMessage(selectedForEvent ? 'Event-Set ausgewählt.' : 'Event-Set abgewählt.');
    } catch (error) {
      showGameError(error);
    }
  }

  async function startBattleEvent(): Promise<void> {
    const response = await fetch('/api/admin/events/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID() })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      window.alert(payload?.message ?? 'Event konnte nicht gestartet werden.');
      return;
    }
    await loadLedger();
    await loadBattleEvents();
    window.alert('Event erfolgreich gestartet.');
  }

  async function loadBattleEvents(): Promise<void> {
    const response = await fetch('/api/admin/events', {
      credentials: 'include'
    });
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
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      window.alert(
        payload?.message ?? 'Battle-Event konnte nicht revertiert werden.'
      );
      return;
    }
    await loadBattleEvents();
    await loadLedger();
  }

  async function revertLedger(
    ledgerId: string,
    userId: string | null
  ): Promise<void> {
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
    let overlaySecret = '';

    try {
      const response = await fetch('/api/admin/overlay-config', {
        credentials: 'include'
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          overlaySecret?: string | null;
        };
        overlaySecret = payload.overlaySecret ?? '';
      }
    } catch {
      overlaySecret = '';
    }

    const sourceUrl = new URL(path, window.location.origin);
    if (overlaySecret) {
      sourceUrl.searchParams.set('token', overlaySecret);
    }

    const copyValue = sourceUrl.toString();

    try {
      await navigator.clipboard.writeText(copyValue);
      window.alert(`OBS-Overlay-Link kopiert: ${copyValue}`);
    } catch {
      window.alert(
        `Kopieren fehlgeschlagen. Bitte manuell kopieren:\n${copyValue}`
      );
    }
  }

  const activeOverlayAlert = overlayAlertQueue[0] ?? null;

  useEffect(() => {
    if (!isAlertOverlayRoute) return;
    const overlayToken =
      new URLSearchParams(window.location.search).get('token') ?? '';
    const sourceUrl = overlayToken
      ? `/api/events/overlay/alerts/stream?token=${encodeURIComponent(overlayToken)}`
      : '/api/events/overlay/alerts/stream';
    const source = new EventSource(sourceUrl);
    source.addEventListener('overlay_alert', (event) => {
      const payload = JSON.parse(
        (event as MessageEvent<string>).data
      ) as OverlayAlertEvent;
      setOverlayAlertQueue((current) => [...current, payload].slice(-10));
    });
    source.onerror = () => source.close();
    return () => source.close();
  }, [isAlertOverlayRoute]);

  useEffect(() => {
    if (!activeOverlayAlert) return;
    const timeoutId = window.setTimeout(() => {
      setOverlayAlertQueue((current) =>
        current.filter((alert) => alert.id !== activeOverlayAlert.id)
      );
    }, activeOverlayAlert.durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeOverlayAlert]);

  useEffect(() => {
    if (!isBattleOverlayRoute) return;
    const overlayToken =
      new URLSearchParams(window.location.search).get('token') ?? '';
    const streamUrl = overlayToken
      ? `/api/events/overlay/battle/stream?token=${encodeURIComponent(overlayToken)}`
      : '/api/events/overlay/battle/stream';
    const battleUrl = overlayToken
      ? `/api/events/overlay/battle?token=${encodeURIComponent(overlayToken)}`
      : '/api/events/overlay/battle';
    const source = new EventSource(streamUrl);
    source.addEventListener('battle_result', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        winners?: OverlayBattleWinner[];
      };
      const winners = payload.winners ?? [];
      setBattleWinners(winners);
      setOverlayLeaders(
        winners.map((winner, index) => ({
          rank: index + 1,
          userName: winner.userName,
          points: winner.pointsAwarded
        }))
      );
    });
    source.onerror = () => source.close();
    fetch(battleUrl)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          winners?: OverlayBattleWinner[];
        };
        const winners = payload.winners ?? [];
        setBattleWinners(winners);
        setOverlayLeaders(
          winners.map((winner, index) => ({
            rank: index + 1,
            userName: winner.userName,
            points: winner.pointsAwarded
          }))
        );
      })
      .catch(() => undefined);
    return () => source.close();
  }, [isBattleOverlayRoute]);

  if (isAlertOverlayRoute) {
    return (
      <main className="overlay-canvas overlay-alerts" aria-live="polite">
        {activeOverlayAlert ? (
          <section
            key={activeOverlayAlert.id}
            className={`overlay-alert-card overlay-alert-card--${activeOverlayAlert.accent}`}
            style={
              {
                '--overlay-alert-duration': `${activeOverlayAlert.durationMs}ms`
              } as CSSProperties
            }
          >
            <p className="overlay-alert-kicker">{activeOverlayAlert.title}</p>
            <p className="overlay-alert-message">
              {activeOverlayAlert.message}
            </p>
          </section>
        ) : null}
      </main>
    );
  }

  if (isBattleOverlayRoute) {
    return (
      <main className="overlay-canvas overlay-battle">
        <section className="overlay-panel">
          <h2>🏆 Event Top 3</h2>
          <ol>
            {battleWinners.map((winner) => (
              <li
                key={`${winner.placement}-${winner.userName}-${winner.petName}`}
              >
                Platz {winner.placement}: <strong>{winner.userName}</strong> mit{' '}
                <strong>{winner.petName}</strong> (+{winner.pointsAwarded})
              </li>
            ))}
          </ol>
        </section>
        <section className="overlay-panel">
          <h2>📊 Event Leader Alerts</h2>
          <ul>
            {overlayLeaders.map((leader) => (
              <li key={`${leader.rank}-${leader.userName}`}>
                #{leader.rank} <strong>{leader.userName}</strong> (+
                {leader.points})
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  if (isAdminRoute) {
    if (!me?.authenticated || !me.isAdmin)
      return (
        <main className="container">
          <section className="card">
            <h2>Adminbereich</h2>
            <p>Zugriff verweigert.</p>
          </section>
        </main>
      );
    const selected = users.find((x) => x.id === selectedUserId) ?? null;

    return (
      <main className="container">
        <section className="card">
          <h2>Adminbereich</h2>
          {adminHealthIssue?.code === 'NO_ACTIVE_EGG_TYPES' ? (
            <p role="alert">
              <strong>⚠ Konfigurationsfehler:</strong> Keine aktiven Ei-Typen
              vorhanden. Bitte Migration + Seed ausführen.
            </p>
          ) : null}
          <p>Nutzerverwaltung (Milestone 3 Fundament).</p>
          <button onClick={() => void startBattleEvent()}>
            Stream-Event starten (3 zufällige Pets)
          </button>
          <button onClick={() => void loadBattleEvents()}>
            Battle-Events laden
          </button>
          <div>
            <button onClick={() => void copyOverlaySource('alerts')}>
              OBS-Link kopieren: Hatch Alerts
            </button>
            <button onClick={() => void copyOverlaySource('battle')}>
              OBS-Link kopieren: Battle Top 3
            </button>
          </div>
          <p>
            <a href="/">Zurück zur Startseite</a>
          </p>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Suche nach Name, Login oder Twitch-ID"
          />
          <button onClick={() => void loadUsers(query)}>Suchen</button>
          <ul>
            {users.map((user) => (
              <li key={user.id}>
                <button onClick={() => setSelectedUserId(user.id)}>
                  {user.displayName ?? user.login ?? user.twitchUserId}
                </button>{' '}
                · Rollen: {user.roles.join(', ') || 'user'}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Battle-Events</h2>
          <ul>
            {battleEvents.map((event) => (
              <li key={event.id}>
                <strong>{event.status}</strong> ·{' '}
                {new Date(event.createdAt).toLocaleString()}
                <button
                  disabled={event.status === 'reverted'}
                  onClick={() => void revertBattleEvent(event.id)}
                >
                  Battle revertieren
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Redemption-Verwaltung</h2>
          <p>Verwaltung und Übersicht der Twitch Custom Rewards.</p>
          <div>
            <button onClick={() => void syncTwitchCustomRewards()}>
              Twitch Custom Rewards mit Ei-Typen synchronisieren
            </button>
            <button onClick={() => void loadTwitchCustomRewards()}>
              Alle Custom Rewards laden
            </button>
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
              <p>
                <strong>{selected.displayName ?? selected.login}</strong> (
                {selected.twitchUserId})
              </p>
              <p>Rollen: {selected.roles.join(', ') || 'user'}</p>
              <p>
                Abo-Status:{' '}
                {selected.isSubscriber ? '✅ Aktiv' : '❌ Nicht aktiv'}
                {selected.subscriberEndsAt
                  ? ` (Ende: ${new Date(selected.subscriberEndsAt).toLocaleString()})`
                  : ''}
              </p>
              {me.roles.includes('owner') ? (
                <div>
                  <button
                    onClick={() =>
                      void changeRole(selected.id, 'admin', 'grant')
                    }
                  >
                    Als Admin setzen
                  </button>
                  <button
                    onClick={() =>
                      void changeRole(selected.id, 'admin', 'revoke')
                    }
                  >
                    Admin entfernen
                  </button>
                  <button
                    onClick={() =>
                      void changeRole(selected.id, 'moderator', 'grant')
                    }
                  >
                    Als Moderator setzen
                  </button>
                  <button
                    onClick={() =>
                      void changeRole(selected.id, 'moderator', 'revoke')
                    }
                  >
                    Moderator entfernen
                  </button>
                </div>
              ) : (
                <p>Nur Owner dürfen Rollen ändern.</p>
              )}
              <div>
                <button
                  onClick={() =>
                    void grantTestEgg(selected.id, 'beta_egg')
                  }
                >
                  Beta-Test-Ei
                </button>
                <button onClick={() => void loadInventory(selected.id)}>
                  Inventar laden
                </button>
                <button onClick={() => void loadLedger(selected.id)}>
                  Ledger laden
                </button>
              </div>
            </>
          ) : (
            <p>Bitte einen Nutzer auswählen.</p>
          )}
        </section>
        <section className="card">
          <h2>Inventar (JSON)</h2>
          <pre>{inventoryJson || 'Kein Inventar geladen.'}</pre>
        </section>

        <section className="card">
          <h2>Debug: EventSub Subscription Status</h2>
          <button onClick={() => void loadEventSubSubscriptionStatus(true)}>
            Status aktualisieren
          </button>
          {eventSubSubscriptionStatus ? (
            <>
              <p>
                Status:{' '}
                {eventSubSubscriptionStatus.status === 'enabled'
                  ? '✅ Aktiviert'
                  : eventSubSubscriptionStatus.status ===
                        'pending_verification' ||
                      eventSubSubscriptionStatus.status === 'duplicate'
                    ? '⚠ Ausstehend / Mehrdeutig'
                    : '❌ Nicht eingerichtet / Fehler'}
              </p>
              <p>Typ: {eventSubSubscriptionStatus.type}</p>
              <p>
                Subscription ID:{' '}
                {eventSubSubscriptionStatus.subscriptionId ?? '—'}
              </p>
              <p>Callback: {eventSubSubscriptionStatus.callback}</p>
              <p>
                Erstellt:{' '}
                {eventSubSubscriptionStatus.createdAt
                  ? new Date(
                      eventSubSubscriptionStatus.createdAt
                    ).toLocaleString()
                  : '—'}
              </p>
              <p>
                Letzte Prüfung:{' '}
                {new Date(
                  eventSubSubscriptionStatus.lastCheckedAt
                ).toLocaleString()}
              </p>
              {eventSubSubscriptionStatus.error ? (
                <p>Fehler: {eventSubSubscriptionStatus.error}</p>
              ) : null}
            </>
          ) : (
            <p>Kein Status geladen.</p>
          )}
        </section>

        <section className="card">
          <h2>Debug: Twitch EventSub Feed (letzte 25)</h2>
          <button onClick={() => void loadEventSubFeed()}>
            Feed aktualisieren
          </button>
          <ul>
            {eventSubFeed.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong> ·{' '}
                {new Date(event.receivedAt).toLocaleString()} · Status:{' '}
                {event.processingStatus}
                <div>Event ID: {event.twitchEventId}</div>
                <div>Quelle: {event.source}</div>
                {event.processedAt ? (
                  <div>
                    Verarbeitet: {new Date(event.processedAt).toLocaleString()}
                  </div>
                ) : null}
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
                <strong>{entry.eventType}</strong> ·{' '}
                {new Date(entry.createdAt).toLocaleString()} · reverted:{' '}
                {String(entry.isReverted)}
                <button
                  disabled={
                    entry.isReverted ||
                    entry.eventType !== 'admin_test_mystery_egg_grant'
                  }
                  onClick={() => void revertLedger(entry.id, entry.userId)}
                >
                  Revert
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  const showAdminNav =
    me?.authenticated &&
    (me.roles.includes('owner') || me.roles.includes('admin'));
  const selectedEventPet =
    playerInventory?.pets.slots
      .map((cell) => cell.item)
      .find((pet): pet is PetItem => pet?.selectedForEvent === true) ?? null;
  const selectedEventSet =
    playerInventory?.equipmentSets.find((set) => set.selectedForEvent) ?? null;

  function renderGrid<T extends { id: string }>(
    title: string,
    grid: InventoryGrid<T>,
    kind: Exclude<DragPayload['kind'], 'incubator'>,
    renderItem: (item: T, slotIndex: number) => JSX.Element,
    className = '',
    getItemClassName?: (item: T) => string,
    renderAfterGrid?: JSX.Element
  ): JSX.Element {
    return (
      <section className={`inventory-panel ${className}`}>
        <h3>{title}</h3>
        <p className="inventory-capacity">
          {grid.slots.filter((cell) => cell.item).length}/
          {grid.dimensions.capacity} Slots · {grid.dimensions.columns}×
          {grid.dimensions.rows}
        </p>
        <div
          className="inventory-grid"
          style={{
            gridTemplateColumns: `repeat(${grid.dimensions.columns}, minmax(0, 1fr))`
          }}
        >
          {grid.slots.map((cell) => (
            <div
              key={cell.slotIndex}
              role="button"
              tabIndex={0}
              className={`inventory-slot ${cell.item ? 'occupied' : 'empty'} ${kind}-slot ${cell.item && getItemClassName ? getItemClassName(cell.item) : ''} ${selectedPayload ? 'select-target' : ''}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleDropToSlot(kind, cell.slotIndex);
              }}
              onClick={() => {
                if (cell.item) {
                  const payload: DragPayload = { kind, id: cell.item.id };
                  selectOrRun(payload, kind, cell.slotIndex);
                } else {
                  void handleDropToSlot(kind, cell.slotIndex);
                }
              }}
              aria-label={`${title} Slot ${cell.slotIndex + 1}`}
            >
              {cell.item ? (
                renderItem(cell.item, cell.slotIndex)
              ) : (
                <span className="empty-slot-label">Leer</span>
              )}
            </div>
          ))}
        </div>
        {renderAfterGrid}
      </section>
    );
  }

  function renderEquipmentSetsPanel(sets: EquipmentSet[]): JSX.Element {
    return (
      <section className="inventory-panel equipment-set-panel">
        <div className="equipment-set-header">
          <div>
            <h3>Ausrüstungssets</h3>
            <p className="inventory-capacity">Ausrüstung im Set verschwindet aus dem normalen Raster.</p>
          </div>
        </div>
        <div className="equipment-set-list">
          {sets.map((set) => (
            <article
              key={set.id}
              className={`equipment-set-card ${set.selectedForEvent ? 'selected-event-set' : ''}`}
            >
              <div className="equipment-set-title">
                <strong>{set.label || `Set ${set.setIndex + 1}`}</strong>
                {set.selectedForEvent ? <span>Event-Set</span> : null}
              </div>
              <div className="equipment-set-slots">
                {set.slots.map((slot) => (
                  <button
                    key={slot.slotIndex}
                    type="button"
                    className={`equipment-set-slot ${slot.item ? 'occupied' : 'empty'} ${(selectedPayload?.kind === 'equipment' || selectedPayload?.kind === 'equipment-set') ? 'select-target' : ''}`}
                    draggable={Boolean(slot.item)}
                    onDragStart={() => {
                      if (slot.item) setDragPayload({ kind: 'equipment-set', id: slot.item.id });
                    }}
                    onDragEnd={() => setDragPayload(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleDropToSlot('equipment-set', slot.slotIndex, set.id);
                    }}
                    onClick={() => {
                      if (slot.item) {
                        selectOrRun({ kind: 'equipment-set', id: slot.item.id }, 'equipment-set', slot.slotIndex, set.id);
                      } else {
                        void handleDropToSlot('equipment-set', slot.slotIndex, set.id);
                      }
                    }}
                  >
                    {slot.item ? (
                      <span className="equipment-set-slot-content">
                        {renderSlotAsset({
                          folder: 'equipment',
                          assetKey: slot.item.equipmentTypeId,
                          label: slot.item.equipmentTypeId,
                          size: 28
                        })}
                        <span>
                          <strong>{slot.item.equipmentTypeId}</strong>
                          <small>Ausrüstung zurücklegen: ins Raster ziehen</small>
                        </span>
                      </span>
                    ) : (
                      <span>Slot frei</span>
                    )}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="event-set-button"
                onClick={() =>
                  void handleEventEquipmentSetSelection(set.id, !set.selectedForEvent)
                }
              >
                {set.selectedForEvent ? 'Event-Set abwählen' : 'Set auswählen'}
              </button>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderEventPetSelectionSlot(
    selectedPet: PetItem | null
  ): JSX.Element {
    return (
      <section className="event-pet-panel">
        <div
          role="button"
          tabIndex={0}
          className={`inventory-slot event-pet-drop-target ${selectedPet ? 'occupied selected-event-pet-slot' : 'empty'} ${selectedPayload?.kind === 'pet' ? 'select-target' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void handleDropToEventPetSlot();
          }}
          onClick={() => {
            if (selectedPayload?.kind === 'pet') {
              void handleDropToEventPetSlot();
            }
          }}
          aria-label="Event-Pet Auswahl-Slot"
        >
          {selectedPet ? (
            <div className="slot-content slot-content-with-asset">
              {renderSlotAsset({
                folder: 'pets',
                assetKey: getPetAssetKey(selectedPet.speciesId),
                label: selectedPet.speciesDisplayName,
                size: 56
              })}
              <div className="slot-text">
                <strong>{selectedPet.speciesDisplayName}</strong>
                <span>Event-Pet</span>
              </div>
            </div>
          ) : (
            <span className="empty-slot-label">Pet hier ablegen</span>
          )}
        </div>
        <div className="event-pet-details">
          <span className="event-pet-label">Event-Auswahl</span>
          <strong>
            {selectedPet?.speciesDisplayName ?? 'Kein Pet ausgewählt'}
          </strong>
          <div className="event-pet-stat-grid">
            <span>Seltenheit: {selectedPet?.rarityLabelDe ?? '—'}</span>
            <span>Klasse: {selectedPet?.classLabelDe ?? '—'}</span>
            <span>Level: {selectedPet?.level ?? '—'}</span>
            <span>EXP: {selectedPet?.experience ?? '—'}</span>
            <span>
              Favorit: {selectedPet ? (selectedPet.isFavorite ? 'Ja' : 'Nein') : '—'}
            </span>
            <span>HP: {selectedPet?.baseHp ?? '—'}</span>
            <span>ATK: {selectedPet?.baseAtk ?? '—'}</span>
            <span>DEF: {selectedPet?.baseDef ?? '—'}</span>
            <span>SPD: {selectedPet?.baseSpd ?? '—'}</span>
          </div>
          {selectedPet ? (
            <button
              type="button"
              className="event-pet-deselect-button"
              onClick={() => void handleDeselectEventPet(selectedPet.id)}
            >
              Event-Pet abwählen
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  function getInventoryActionSlotStyle(columns: number): CSSProperties {
    const span = Math.min(2, columns);
    const startColumn = Math.max(1, columns - span + 1);
    return {
      gridColumn: `${startColumn} / span ${span}`,
      gridRow: `span ${span}`
    };
  }

  function renderPetTrashSlot(columns: number): JSX.Element {
    return (
      <div
        className="inventory-grid pet-trash-row"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
        }}
      >
        <div
          role="button"
          tabIndex={0}
          className={`inventory-slot pet-trash-drop-target empty ${selectedPayload?.kind === 'pet' ? 'select-target' : ''}`}
          style={{ gridColumn: `${columns} / span 1` }}
          onDragOver={(event) => {
            if ((dragPayload ?? selectedPayload)?.kind === 'pet')
              event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            void handleDropToSlot('trashcan', 0);
          }}
          onClick={() => {
            if (selectedPayload?.kind === 'pet')
              void handleDropToSlot('trashcan', 0);
          }}
          aria-label="Pet verwerten"
        >
          <div className="slot-content pet-trash-content">
            <strong>Verwerten</strong>
            <span>Pet ablegen</span>
          </div>
        </div>
      </div>
    );
  }

  function renderInventoryDiscardSlot(
    columns: number,
    acceptedKind: InventoryDiscardKind
  ): JSX.Element {
    const activePayload = dragPayload ?? selectedPayload;
    const canDiscard = activePayload?.kind === acceptedKind;
    return (
      <div
        className="inventory-grid inventory-discard-row"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
        }}
      >
        <div
          role="button"
          tabIndex={0}
          className={`inventory-slot inventory-discard-drop-target empty ${canDiscard ? 'select-target' : ''}`}
          style={getInventoryActionSlotStyle(columns)}
          onDragOver={(event) => {
            if (canDiscard) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (canDiscard) void handleDropToSlot('discard', 0);
          }}
          onClick={() => {
            if (canDiscard) void handleDropToSlot('discard', 0);
          }}
          aria-label="Gegenstand verwerfen"
        >
          <div className="slot-content inventory-discard-content">
            <strong>Verwerfen</strong>
            <span>Keine Belohnung</span>
          </div>
        </div>
      </div>
    );
  }

  function renderIncubatorInventory(
    inventory: IncubatorInventory
  ): JSX.Element {
    const incubators = inventory.incubators;

    return (
      <section className="inventory-panel incubator-panel">
        <h3>Inkubatoren</h3>
        <p className="inventory-capacity">
          {incubators.length} Queue-Slots · Fortschritt zählt nur, wenn der
          Stream online ist
        </p>
        {incubators.length > 0 ? (
          <div className="incubator-list">
            {incubators.map((incubator) => {
              const active = incubator.activeJob;
              const liveClientProgress =
                active?.state === 'running' && active.lastProgressedAt
                  ? Math.max(
                      0,
                      Math.floor(
                        (nowMs - new Date(active.lastProgressedAt).getTime()) /
                          1000
                      )
                    )
                  : 0;
              const secondsRemaining = active
                ? Math.max(
                    0,
                    active.requiredProgressSeconds -
                      active.progressSecondsAccumulated -
                      liveClientProgress
                  )
                : null;
              const canStartEgg = incubator.isAvailable && !active;
              const isInactiveEmptySlot = !active && !incubator.isAvailable;
              return (
                <div
                  key={incubator.id}
                  role="button"
                  tabIndex={0}
                  className={`inventory-slot occupied incubator-slot incubator-drop-target ${isInactiveEmptySlot ? 'incubator-inactive' : ''} ${selectedPayload?.kind === 'egg' && canStartEgg ? 'select-target' : ''}`}
                  onDragOver={(event) => {
                    if (canStartEgg) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (canStartEgg)
                      void handleDropToSlot('incubator', 0, incubator.id);
                  }}
                  onClick={() => {
                    if (selectedPayload?.kind === 'egg' && canStartEgg) {
                      void handleDropToSlot('incubator', 0, incubator.id);
                    }
                  }}
                  aria-label={`${formatIncubatorSource(incubator.slotSource)} Queue-Slot ${(incubator.slotIndex ?? 0) + 1}`}
                >
                  <div className="slot-content">
                    <strong>
                      {formatIncubatorSource(incubator.slotSource)}
                    </strong>
                    <span>Queue-Slot {(incubator.slotIndex ?? 0) + 1}</span>
                    {active ? (
                      <>
                        <span className="slot-progress">
                          {active.state === 'queued'
                            ? 'Warteschlange'
                            : formatRemainingDuration(secondsRemaining ?? 0)}
                        </span>
                        <span>
                          {active.state === 'queued'
                            ? 'Startet automatisch, sobald der Stream live ist und kein Ei brütet'
                            : 'Zählt nur während Live-Stream'}
                        </span>
                        {active.state === 'running' &&
                        (secondsRemaining ?? 1) <= 0 ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void finishIncubation(active.unhatchedEggId)
                                .then(refreshOwnInventory)
                                .catch(showGameError);
                            }}
                          >
                            Abholen
                          </button>
                        ) : null}
                      </>
                    ) : canStartEgg ? (
                      <span>Frei · Ei hier ablegen</span>
                    ) : (
                      <span>Inaktiv</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p>Keine Inkubatoren verfügbar.</p>
        )}
      </section>
    );
  }

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
              Angemeldet als{' '}
              <strong>{me.user.displayName ?? me.user.login}</strong>
            </p>
            {me.user.avatarUrl ? (
              <img
                src={me.user.avatarUrl}
                alt="Profilbild"
                width={72}
                height={72}
              />
            ) : null}
            <p>Rolle: {me.isAdmin ? 'Admin' : 'Spieler'}</p>
            {showAdminNav ? (
              <p>
                <a href="/admin">Zum Adminbereich</a>
              </p>
            ) : null}
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
                <strong>
                  {entry.displayName ?? entry.login ?? `Spieler ${entry.rank}`}
                </strong>{' '}
                · {entry.score} Punkte
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
                {gameMessage ? (
                  <p className="game-message" role="status">
                    {gameMessage}
                  </p>
                ) : null}
                {pendingPetScrap ? (
                  <div className="modal-backdrop" role="presentation">
                    <div
                      className="confirm-modal"
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby="pet-scrap-confirm-title"
                      aria-describedby="pet-scrap-confirm-description"
                    >
                      <strong id="pet-scrap-confirm-title">
                        {pendingPetScrap.label} wirklich verwerten?
                      </strong>
                      <p id="pet-scrap-confirm-description">
                        Dieses Pet wird dauerhaft gelöscht und du erhältst
                        Aufgebrochene Eier abhängig von der Seltenheit (
                        {pendingPetScrap.rarity}).
                      </p>
                      <div className="confirm-actions">
                        <button
                          ref={petScrapConfirmButtonRef}
                          type="button"
                          onClick={() => void confirmPetScrap()}
                          disabled={isPetScrapSubmitting}
                        >
                          {isPetScrapSubmitting
                            ? 'Wird verwertet …'
                            : 'Ja, verwerten'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingPetScrap(null)}
                          disabled={isPetScrapSubmitting}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {pendingInventoryDiscard ? (
                  <div className="modal-backdrop" role="presentation">
                    <div
                      className="confirm-modal"
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby="inventory-discard-confirm-title"
                      aria-describedby="inventory-discard-confirm-description"
                    >
                      <strong id="inventory-discard-confirm-title">
                        {pendingInventoryDiscard.label} wirklich verwerfen?
                      </strong>
                      <p id="inventory-discard-confirm-description">
                        Der Gegenstand wird dauerhaft gelöscht. Du erhältst
                        dafür keine Ressourcen oder andere Belohnungen.
                      </p>
                      <div className="confirm-actions">
                        <button
                          type="button"
                          onClick={() => void confirmInventoryDiscard()}
                          disabled={isInventoryDiscardSubmitting}
                        >
                          {isInventoryDiscardSubmitting
                            ? 'Wird verworfen …'
                            : 'Ja, verwerfen'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingInventoryDiscard(null)}
                          disabled={isInventoryDiscardSubmitting}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="resource-summary">
                  <h3>Gezählte Vorräte</h3>
                  <p>
                    <strong>Mystery-Eier:</strong>{' '}
                    {playerInventory.mysteryEggs.reduce(
                      (sum, entry) => sum + entry.amount,
                      0
                    )}
                  </p>
                  {playerInventory.mysteryEggs
                    .filter((entry) => entry.amount > 0)
                    .map((entry) => (
                      <p key={entry.eggTypeId} className="resource-row">
                        {renderSlotAsset({
                          folder: 'eggs',
                          assetKey: getEggAssetKey(entry.eggTypeId),
                          label: formatMysteryEggType(entry.eggTypeId),
                          size: 28
                        })}
                        <span>
                          <strong>
                            {formatMysteryEggType(entry.eggTypeId)}:
                          </strong>{' '}
                          {entry.amount}
                        </span>{' '}
                        <button
                          type="button"
                          onClick={() =>
                            void identifyMysteryEgg(entry.eggTypeId)
                              .then(refreshOwnInventory)
                              .catch(showGameError)
                          }
                        >
                          Typ bestimmen
                        </button>
                      </p>
                    ))}
                  <p>
                    <strong>Ei-Ressourcen:</strong>{' '}
                    {playerInventory.crackedEggResources.reduce(
                      (sum, entry) => sum + entry.amount,
                      0
                    )}
                  </p>
                  {playerInventory.crackedEggResources
                    .filter((entry) => entry.amount > 0)
                    .map((entry) => (
                      <p key={entry.resourceType}>
                        <strong>
                          {formatEggResourceType(entry.resourceType)}:
                        </strong>{' '}
                        {entry.amount}
                      </p>
                    ))}
                </div>
                <div className="inventory-stack">
                  {renderIncubatorInventory(playerInventory.incubators)}
                  {renderGrid(
                    'Unausgebrütete Eier',
                    playerInventory.unhatchedEggs,
                    'egg',
                    (egg) => (
                      <div
                        draggable
                        onDragStart={() =>
                          setDragPayload({ kind: 'egg', id: egg.id })
                        }
                        onDragEnd={() => setDragPayload(null)}
                        className="slot-content slot-content-with-asset"
                      >
                        {renderSlotAsset({
                          folder: 'eggs',
                          assetKey: getEggAssetKey(egg.eggTypeId),
                          label: formatMysteryEggType(egg.eggTypeId),
                          size: 56
                        })}
                        <div className="slot-text">
                          <strong>{formatMysteryEggType(egg.eggTypeId)}</strong>
                          <span>Bereit</span>
                        </div>
                      </div>
                    ),
                    'egg-panel',
                    undefined,
                    renderInventoryDiscardSlot(
                      playerInventory.unhatchedEggs.dimensions.columns,
                      'egg'
                    )
                  )}
                  <section className="inventory-panel pet-panel">
                    <h3>Pets</h3>
                    <p className="inventory-capacity">
                      Pet in den Event-Slot ziehen oder antippen und dann den
                      Event-Slot wählen.
                    </p>
                    {renderEventPetSelectionSlot(selectedEventPet)}
                    <div className="event-set-summary">
                      <span>Event-Set</span>
                      <strong>{selectedEventSet?.label ?? 'Kein Set ausgewählt'}</strong>
                      <small>{selectedEventSet ? `${selectedEventSet.slots.filter((slot) => slot.item).length}/${selectedEventSet.slotCount} Slots belegt` : 'Optional für Beta-Battles'}</small>
                    </div>
                  </section>
                  {renderGrid(
                    'Pet-Inventar',
                    playerInventory.pets,
                    'pet',
                    (pet) => (
                      <div
                        draggable
                        onDragStart={() =>
                          setDragPayload({ kind: 'pet', id: pet.id })
                        }
                        onDragEnd={() => setDragPayload(null)}
                        className="pet-slot-card"
                        title={`${pet.speciesDisplayName} · ${pet.rarityLabelDe} · ${pet.classLabelDe} · ${pet.elementLabelDe}`}
                      >
                        <div className="pet-slot-main">
                          <div className="pet-slot-picture">
                            {renderSlotAsset({
                              folder: 'pets',
                              assetKey: getPetAssetKey(pet.speciesId),
                              label: pet.speciesDisplayName,
                              size: 56,
                              className: 'pet-slot-asset'
                            })}
                          </div>
                          <div
                            className="pet-slot-emblems"
                            aria-label={`${pet.rarityLabelDe}, Level ${pet.level}, ${pet.classLabelDe}, ${pet.elementLabelDe}`}
                          >
                            <span
                              className={`pet-emblem pet-emblem-favorite ${pet.isFavorite ? 'is-visible' : ''}`}
                              aria-label={
                                pet.isFavorite ? 'Favorit' : 'Kein Favorit'
                              }
                              title={
                                pet.isFavorite ? 'Favorit' : 'Kein Favorit'
                              }
                            >
                              {pet.isFavorite
                                ? renderEmblemAsset('favorite', 'Favorit')
                                : null}
                            </span>
                            <span
                              className="pet-emblem pet-emblem-level"
                              aria-label={`Level ${pet.level}`}
                              title={`Level ${pet.level}`}
                            >
                              {pet.level}
                            </span>
                            <span
                              className="pet-emblem pet-emblem-class"
                              aria-label={pet.classLabelDe}
                              title={pet.classLabelDe}
                            >
                              {renderEmblemAsset(
                                `classes/${pet.classId}`,
                                pet.classLabelDe
                              )}
                            </span>
                            <span
                              className="pet-emblem pet-emblem-element"
                              aria-label={pet.elementLabelDe}
                              title={pet.elementLabelDe}
                            >
                              {renderEmblemAsset(
                                `elements/${pet.elementId}`,
                                pet.elementLabelDe
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="pet-slot-name">
                          <strong>{pet.nickname ?? pet.speciesDisplayName}</strong>
                        </div>
                      </div>
                    ),
                    'pet-grid-panel',
                    (pet) =>
                      `${pet.selectedForEvent ? 'selected-event-pet' : ''} ${getPetRarityClassName(pet.rarityId)}`.trim(),
                    renderPetTrashSlot(playerInventory.pets.dimensions.columns)
                  )}
                  {renderGrid(
                    'Verbrauchbares',
                    playerInventory.consumables,
                    'consumable',
                    (item) => (
                      <div
                        draggable
                        onDragStart={() =>
                          setDragPayload({ kind: 'consumable', id: item.id })
                        }
                        onDragEnd={() => setDragPayload(null)}
                        className="slot-content slot-content-with-asset"
                      >
                        {renderSlotAsset({
                          folder: 'consumables',
                          assetKey: item.consumableTypeId,
                          label: item.consumableTypeId,
                          size: 28
                        })}
                        <div className="slot-text">
                          <strong>{item.consumableTypeId}</strong>
                          <span className="stack-badge">Einzeln</span>
                        </div>
                      </div>
                    ),
                    'item-panel',
                    undefined,
                    renderInventoryDiscardSlot(
                      playerInventory.consumables.dimensions.columns,
                      'consumable'
                    )
                  )}
                  {renderEquipmentSetsPanel(playerInventory.equipmentSets)}
                  {renderGrid(
                    'Ausrüstung',
                    playerInventory.equipment,
                    'equipment',
                    (equipment) => (
                      <div
                        draggable
                        onDragStart={() =>
                          setDragPayload({ kind: 'equipment', id: equipment.id })
                        }
                        onDragEnd={() => setDragPayload(null)}
                        className="slot-content slot-content-with-asset"
                      >
                        {renderSlotAsset({
                          folder: 'equipment',
                          assetKey: equipment.equipmentTypeId,
                          label: equipment.equipmentTypeId,
                          size: 28
                        })}
                        <div className="slot-text">
                          <strong>{equipment.equipmentTypeId}</strong>
                          <span>Einzeln</span>
                        </div>
                      </div>
                    ),
                    'item-panel',
                    undefined,
                    renderInventoryDiscardSlot(
                      playerInventory.equipment.dimensions.columns,
                      'equipment'
                    )
                  )}
                  {renderGrid(
                    'Hüte',
                    playerInventory.hats,
                    'hat',
                    (hat) => (
                      <div
                        draggable
                        onDragStart={() =>
                          setDragPayload({ kind: 'hat', id: hat.id })
                        }
                        onDragEnd={() => setDragPayload(null)}
                        className="slot-content slot-content-with-asset"
                      >
                        {renderSlotAsset({
                          folder: 'hats',
                          assetKey: hat.hatId,
                          label: hat.hatId,
                          size: 28
                        })}
                        <div className="slot-text">
                          <strong>{hat.hatId}</strong>
                          <span>Einzeln</span>
                        </div>
                      </div>
                    ),
                    'item-panel',
                    undefined,
                    renderInventoryDiscardSlot(
                      playerInventory.hats.dimensions.columns,
                      'hat'
                    )
                  )}
                </div>
              </>
            ) : (
              <p>Inventar wird geladen…</p>
            )}
          </>
        ) : (
          <p>Nach dem Login siehst du hier deinen Spielbereich.</p>
        )}
      </section>
    </main>
  );
}
