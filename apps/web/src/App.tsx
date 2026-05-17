import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent
} from 'react';


type PlayerDialogAction = {
  label: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

type PlayerDialogProps = {
  id: string;
  title: string;
  children?: ReactNode;
  description?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  variant?: 'danger' | 'info';
  className?: string;
  actions: PlayerDialogAction[];
  onCancel?: () => void;
  cancelDisabled?: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

function PlayerDialog({
  id,
  title,
  children,
  description,
  role = 'dialog',
  variant = 'danger',
  className = '',
  actions,
  onCancel,
  cancelDisabled = false,
  onSubmit
}: PlayerDialogProps): JSX.Element {
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const dialogElementRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const cancelDisabledRef = useRef(cancelDisabled);
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  useEffect(() => {
    onCancelRef.current = onCancel;
    cancelDisabledRef.current = cancelDisabled;
  }, [cancelDisabled, onCancel]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      const fieldToFocus = dialogElementRef.current?.querySelector<HTMLElement>(
        'input, textarea, select'
      );
      (fieldToFocus ?? firstActionRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        onCancelRef.current &&
        !cancelDisabledRef.current
      ) {
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const body = (
    <>
      <strong id={titleId}>{title}</strong>
      {description ? <p id={descriptionId}>{description}</p> : null}
      {children}
      <div className="confirm-actions">
        {actions.map((action, index) => (
          <button
            key={`${action.label}:${index}`}
            ref={index === 0 ? firstActionRef : undefined}
            type={action.type ?? 'button'}
            className={action.variant ? `dialog-action-${action.variant}` : undefined}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
  const dialogClassName = `confirm-modal player-dialog player-dialog--${variant} ${className}`.trim();

  return (
    <div className="modal-backdrop" role="presentation">
      {onSubmit ? (
        <form
          ref={(element) => {
            dialogElementRef.current = element;
          }}
          className={dialogClassName}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onSubmit={onSubmit}
        >
          {body}
        </form>
      ) : (
        <div
          ref={(element) => {
            dialogElementRef.current = element;
          }}
          className={dialogClassName}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          {body}
        </div>
      )}
    </div>
  );
}

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

type AdminEggType = {
  id: string;
  displayName: string;
  isActive: boolean;
  isMysteryEggType: boolean;
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


type SetupStatus = {
  completed: boolean;
  requiresReauth: boolean;
  broadcaster: { userId: string; login: string | null } | null;
  requiredScopes: string[];
  missingScopes: string[];
  setupCompletedAt: string | null;
  eventsubSyncedAt: string | null;
  subscriptionBackfillCompletedAt: string | null;
  bitsBackfillCompletedAt: string | null;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  eventSub: EventSubSubscriptionStatus & {
    subscriptions?: Array<{
      eventType: string;
      status: string;
      subscriptionId: string | null;
      callbackUrl: string;
      lastError: string | null;
    }>;
  };
  lastBackfillRuns: Array<{ id: string; type: string; status: string; startedAt: string; completedAt: string | null; source: string; error: string | null }>;
};

type GridDimensions = {
  kind: string;
  columns: number;
  rows: number;
  baseRows: number;
  bonusRows: number;
  capacity: number;
  upgradeRef: string | null;
  nextRowUpgradeCostCrackedEggs: number | null;
};
type GridCell<T> = { slotIndex: number; item: T | null };
type InventoryGrid<T> = {
  dimensions: GridDimensions;
  slots: Array<GridCell<T>>;
};
type IncubatorInventory = {
  dimensions: GridDimensions;
  incubators: IncubatorItem[];
};
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
type PetStatId = 'HP' | 'ATK' | 'DEF' | 'SPD' | 'GAIN' | 'POW';

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
  classMainStat: PetStatId;
  classSecondaryStatOne: PetStatId;
  classSecondaryStatTwo: PetStatId;
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
  trainingPoints: number;
  level: number;
  levelBonusHp: number;
  levelBonusAtk: number;
  levelBonusDef: number;
  levelBonusSpd: number;
  levelBonusGain: number;
  levelBonusPow: number;
  effectiveHp: number;
  effectiveAtk: number;
  effectiveDef: number;
  effectiveSpd: number;
  effectiveGain: number;
  effectivePow: number;
  trainingProgress: {
    level: number;
    trainingPoints: number;
    maxLevel: number;
    pointsIntoCurrentLevel: number;
    pointsRequiredForNextLevel: number | null;
    pointsRemainingForNextLevel: number | null;
  };
  isFavorite: boolean;
  isLocked: boolean;
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
type HatItem = {
  id: string;
  hatId: string;
  labelDe: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
};
type HatCollection = {
  columns: number;
  total: number;
  unlockedCount: number;
  slots: Array<{ slotIndex: number; item: HatItem }>;
};
type EquipmentSetUpgrades = {
  setCount: number;
  setSlotBonusCount: number;
  nextSlotUpgradeCostCrackedEggs: number;
  nextSetCostCrackedEggs: number;
};
type PlayerInventory = {
  mysteryEggs: Array<{ eggTypeId: string; amount: number }>;
  crackedEggResources: Array<{ resourceType: string; amount: number }>;
  incubators: IncubatorInventory;
  unhatchedEggs: InventoryGrid<EggItem>;
  pets: InventoryGrid<PetItem>;
  consumables: InventoryGrid<ConsumableItem>;
  equipment: InventoryGrid<EquipmentItem>;
  equipmentSets: EquipmentSet[];
  equipmentSetUpgrades: EquipmentSetUpgrades;
  hats: HatCollection;
};
type ShopOfferKind = 'equipment' | 'consumable';
type ShopOfferItem = {
  kind: ShopOfferKind;
  typeId: string;
  displayName: string;
  description: string;
  resourcePrice: number;
  stock: number;
  purchasedThisWeek: number;
  remainingThisWeek: number;
};
type ShopOffers = {
  weekKey: string;
  weekStartsAt: string;
  weekEndsAt: string;
  currencyResourceType: string;
  equipmentOfferCount: number;
  consumableOfferCount: number;
  offers: ShopOfferItem[];
};
type SubscriberShopOfferItem = {
  kind: 'pet_hat_pair';
  petSpeciesId: string;
  petDisplayName: string;
  hatId: string;
  hatLabelDe: string;
  displayName: string;
  description: string;
  resourcePrice: number;
  stock: number;
  purchasedThisMonth: number;
  remainingThisMonth: number;
};

type TrainingDialogState = {
  target: PetItem;
  selectedIds: string[];
};

type TrainingPreview = {
  pointsAwarded: number;
  levelBefore: number;
  levelAfter: number;
  statChanges: Record<PetStatId, number>;
};

type SubscriberShopOffers = {
  monthKey: string;
  monthStartsAt: string;
  monthEndsAt: string;
  currencyResourceType: string;
  offerCount: number;
  offers: SubscriberShopOfferItem[];
};

type SelectionPayload =
  | { kind: 'incubator'; id: string }
  | { kind: 'egg'; id: string }
  | { kind: 'pet'; id: string }
  | { kind: 'consumable'; id: string }
  | { kind: 'equipment'; id: string }
  | { kind: 'equipment-set'; id: string }
  | { kind: 'hat'; id: string };
type PetScrapTarget = { petId: string; label: string; rarity: string };
type InventoryDiscardKind = 'egg' | 'consumable' | 'equipment';
type InventoryDiscardTarget = {
  kind: InventoryDiscardKind;
  id: string;
  label: string;
};
type ShopErrorDialog = { title: string; message: string };
type ShopPurchaseDialog = { itemCount: number; totalPrice: number };
type SubscriberShopPurchaseDialog = { offer: SubscriberShopOfferItem };
type EquipmentSetUpgradeDialog = {
  upgradeKind: 'equipment-set-slots' | 'additional-equipment-set';
  title: string;
  description: string;
  cost: number;
};
type InventoryUpgradeDialog = {
  inventoryKind: string;
  title: string;
  newSlotCount: number;
  cost: number;
};
type ToastTone = 'default' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
type ToastMessage = { id: number; text: string; tone: ToastTone };
type MysteryEggIdentifyResponse =
  | { ok: true; result: 'unhatched_egg' }
  | {
      ok: true;
      result: 'resources';
      resourceType: string;
      resourceAmount: number;
    };
type MysteryEggIdentifyApiPayload = {
  ok?: boolean;
  result?: 'unhatched_egg' | 'resources';
  resourceType?: string;
  resourceAmount?: number;
  message?: string;
};
type IncubationFinishResponse = {
  ok: true;
  pet: {
    id: string;
    speciesDisplayName: string;
    rarityId: string;
    rarityLabelDe: string;
  };
};
type IncubationFinishApiPayload = Partial<IncubationFinishResponse> & {
  message?: string;
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


type SlotAssetFolder =
  | 'eggs'
  | 'pets'
  | 'consumables'
  | 'equipment'
  | 'hats'
  | 'resources';

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
  beta_egg: 'Beta Ei',
  starter_egg: 'Starter Ei'
};

const EGG_RESOURCE_LABELS: Record<string, string> = {
  cracked_eggs: 'Aufgebrochene Eier',
  voucher: 'Gutschein'
};

const EGG_RESOURCE_ASSET_KEYS = new Set(['cracked_eggs']);
const CRACKED_EGGS_RESOURCE_TYPE = 'cracked_eggs';
const VOUCHER_RESOURCE_TYPE = 'voucher';
const DEFAULT_EQUIPMENT_SET_BASE_SLOTS = 3;

function formatMysteryEggType(eggTypeId: string): string {
  return MYSTERY_EGG_LABELS[eggTypeId] ?? eggTypeId;
}

function formatEggResourceType(resourceType: string): string {
  return EGG_RESOURCE_LABELS[resourceType] ?? resourceType;
}

function getEggResourceAssetKey(resourceType: string): string | null {
  return EGG_RESOURCE_ASSET_KEYS.has(resourceType) ? resourceType : null;
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

function getToastToneForRarity(rarityId: string): ToastTone {
  const normalized = toCssModifier(rarityId);
  if (
    normalized === 'common' ||
    normalized === 'uncommon' ||
    normalized === 'rare' ||
    normalized === 'epic' ||
    normalized === 'legendary'
  ) {
    return normalized;
  }
  return 'default';
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

function formatUpgradeSlotCount(slotCount: number): string {
  return slotCount === 1 ? '1 neuer Slot' : `${slotCount} neue Slots`;
}

const DEBUG_EGG_GRANT_AMOUNTS = [1, 5, 10] as const;


const PET_STAT_IDS: PetStatId[] = ['HP', 'ATK', 'DEF', 'SPD', 'GAIN', 'POW'];

function consumedPetTrainingValue(level: number): number {
  if (level === 0) return 2;
  if (level === 1) return 3;
  return 2 ** level;
}

function trainingLevelForPoints(points: number, maxLevel: number): number {
  let level = 0;
  let spent = 0;
  while (level < maxLevel) {
    const nextCost = 2 ** (level + 1);
    if (points < spent + nextCost) break;
    spent += nextCost;
    level += 1;
  }
  return level;
}

function petStatPointValue(stat: PetStatId): number {
  return stat === 'HP' ? 10 : 1;
}

function addPetStatPointBonus(bonus: Record<PetStatId, number>, stat: PetStatId, points: number): void {
  bonus[stat] += points * petStatPointValue(stat);
}

function levelBonusForPet(pet: PetItem, level: number): Record<PetStatId, number> {
  const bonus: Record<PetStatId, number> = { HP: 0, ATK: 0, DEF: 0, SPD: 0, GAIN: 0, POW: 0 };
  addPetStatPointBonus(bonus, pet.classMainStat, level * 2);
  addPetStatPointBonus(bonus, pet.classSecondaryStatOne, level);
  addPetStatPointBonus(bonus, pet.classSecondaryStatTwo, level);
  return bonus;
}

function petBaseStatValue(pet: PetItem, stat: PetStatId): number {
  return stat === 'HP' ? pet.baseHp : stat === 'ATK' ? pet.baseAtk : stat === 'DEF' ? pet.baseDef : stat === 'SPD' ? pet.baseSpd : stat === 'GAIN' ? pet.baseGain : pet.basePow;
}

function petLevelBonusValue(pet: PetItem, stat: PetStatId): number {
  return stat === 'HP' ? pet.levelBonusHp : stat === 'ATK' ? pet.levelBonusAtk : stat === 'DEF' ? pet.levelBonusDef : stat === 'SPD' ? pet.levelBonusSpd : stat === 'GAIN' ? pet.levelBonusGain : pet.levelBonusPow;
}

function petEffectiveStatValue(pet: PetItem, stat: PetStatId): number {
  return stat === 'HP' ? pet.effectiveHp : stat === 'ATK' ? pet.effectiveAtk : stat === 'DEF' ? pet.effectiveDef : stat === 'SPD' ? pet.effectiveSpd : stat === 'GAIN' ? pet.effectiveGain : pet.effectivePow;
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
  const [shopOffers, setShopOffers] = useState<ShopOffers | null>(null);
  const [subscriberShopOffers, setSubscriberShopOffers] = useState<SubscriberShopOffers | null>(null);
  const [isBuyingSubscriberShopOffer, setIsBuyingSubscriberShopOffer] = useState(false);
  const [queuedShopItems, setQueuedShopItems] = useState<ShopOfferItem[]>([]);
  const [isBuyingShopQueue, setIsBuyingShopQueue] = useState(false);
  const [eventSubFeed, setEventSubFeed] = useState<EventSubFeedItem[]>([]);
  const [eventSubSubscriptionStatus, setEventSubSubscriptionStatus] =
    useState<EventSubSubscriptionStatus | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [twitchCustomRewards, setTwitchCustomRewards] = useState<
    TwitchCustomReward[]
  >([]);
  const [adminEggTypes, setAdminEggTypes] = useState<AdminEggType[]>([]);
  const [selectedAdminEggTypeId, setSelectedAdminEggTypeId] =
    useState('beta_egg');
  const [leaderboardEntries, setLeaderboardEntries] = useState<
    LeaderboardEntry[]
  >([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [selectedPayload, setSelectedPayload] = useState<SelectionPayload | null>(
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
  const [pendingShopError, setPendingShopError] =
    useState<ShopErrorDialog | null>(null);
  const [pendingShopPurchase, setPendingShopPurchase] =
    useState<ShopPurchaseDialog | null>(null);
  const [pendingSubscriberShopPurchase, setPendingSubscriberShopPurchase] =
    useState<SubscriberShopPurchaseDialog | null>(null);
  const [pendingEquipmentSetUpgrade, setPendingEquipmentSetUpgrade] =
    useState<EquipmentSetUpgradeDialog | null>(null);
  const [pendingInventoryUpgrade, setPendingInventoryUpgrade] =
    useState<InventoryUpgradeDialog | null>(null);
  const [upgradingInventoryKind, setUpgradingInventoryKind] = useState<
    string | null
  >(null);
  const [statsPayload, setStatsPayload] = useState<SelectionPayload | null>(null);
  const [renamePetDraft, setRenamePetDraft] = useState<{ petId: string; nickname: string } | null>(null);
  const [isPetRenameSubmitting, setIsPetRenameSubmitting] = useState(false);
  const [trainingDialog, setTrainingDialog] = useState<TrainingDialogState | null>(null);
  const [isTrainingSubmitting, setIsTrainingSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<ToastMessage | null>(null);
  const [activePlayerPageIndex, setActivePlayerPageIndex] = useState(0);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const toastIdRef = useRef(0);
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

  async function loadSetupStatus(): Promise<void> {
    const response = await fetch('/api/setup/status', { credentials: 'include' });
    if (response.ok) setSetupStatus((await response.json()) as SetupStatus);
  }

  async function postSetupAction(endpoint: string): Promise<void> {
    const response = await fetch(endpoint, { method: 'POST', credentials: 'include' });
    if (response.ok) setSetupStatus((await response.json()) as SetupStatus);
    else await loadSetupStatus();
  }

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

  async function loadShop(): Promise<void> {
    const response = await fetch('/api/game/shop', { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { shop: ShopOffers };
    setShopOffers(payload.shop);
    setQueuedShopItems([]);
  }

  async function loadSubscriberShop(): Promise<void> {
    const response = await fetch('/api/game/subscriber-shop', { credentials: 'include' });
    if (!response.ok) return;
    const payload = (await response.json()) as { shop: SubscriberShopOffers };
    setSubscriberShopOffers(payload.shop);
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
    void loadSetupStatus();
    void loadMe();
    void loadLeaderboard();
  }, []);

  useEffect(() => {
    setSelectedPayload(null);
  }, [activePlayerPageIndex]);

  useEffect(() => {
    if (isAdminRoute && me?.authenticated) {
      void loadSetupStatus();
      void loadUsers(query);
      void loadAdminHealth();
      void loadAdminEggTypes();
      void loadEventSubFeed();
      void loadEventSubSubscriptionStatus();
    }
  }, [isAdminRoute, setupStatus?.completed, me?.authenticated]);

  useEffect(() => {
    if (isAdminRoute || setupStatus?.completed === false || !me?.authenticated || !playerInventory) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isAdminRoute, me?.authenticated, playerInventory]);

  useEffect(() => {
    if (isAdminRoute || setupStatus?.completed === false || !me?.authenticated) {
      setPlayerInventory(null);
      setShopOffers(null);
      setSubscriberShopOffers(null);
      setQueuedShopItems([]);
      return;
    }

    void loadShop();
    void loadSubscriberShop();

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

  async function refreshOwnInventory(): Promise<void> {
    const response = await fetch('/api/game/inventory', {
      credentials: 'include'
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { inventory: PlayerInventory };
    setPlayerInventory(payload.inventory);
  }

  async function identifyMysteryEgg(eggTypeId: string): Promise<MysteryEggIdentifyResponse> {
    const response = await fetch('/api/game/mystery-eggs/identify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eggTypeId })
    });

    const payload = (await response.json().catch(() => null)) as
      | MysteryEggIdentifyApiPayload
      | null;
    if (!response.ok) {
      throw new Error(
        payload?.message ?? 'Mystery-Ei konnte nicht bestimmt werden.'
      );
    }
    if (payload?.ok !== true || !payload.result) {
      throw new Error('Mystery-Ei wurde bestimmt, aber die Antwort war unvollständig.');
    }
    if (payload.result === 'resources') {
      return {
        ok: true,
        result: 'resources',
        resourceType: payload.resourceType ?? CRACKED_EGGS_RESOURCE_TYPE,
        resourceAmount: payload.resourceAmount ?? 0
      };
    }
    return { ok: true, result: 'unhatched_egg' };
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

  async function finishIncubation(unhatchedEggId: string): Promise<IncubationFinishResponse> {
    const response = await fetch('/api/game/incubation/finish', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unhatchedEggId })
    });
    const payload = (await response.json().catch(() => null)) as
      | IncubationFinishApiPayload
      | null;
    if (!response.ok) {
      throw new Error(
        payload?.message ?? 'Inkubation konnte nicht abgeschlossen werden.'
      );
    }
    if (payload?.ok !== true || !payload.pet) {
      throw new Error('Inkubation wurde abgeschlossen, aber die Antwort war unvollständig.');
    }
    return { ok: true, pet: payload.pet };
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

  function getCrackedEggBalance(): number {
    return getResourceBalance(CRACKED_EGGS_RESOURCE_TYPE);
  }

  function getVoucherBalance(): number {
    return getResourceBalance(VOUCHER_RESOURCE_TYPE);
  }

  function getResourceBalance(resourceType: string): number {
    return (
      playerInventory?.crackedEggResources.find(
        (resource) => resource.resourceType === resourceType
      )?.amount ?? 0
    );
  }

  function getShopItemKey(offer: Pick<ShopOfferItem, 'kind' | 'typeId'>): string {
    return `${offer.kind}:${offer.typeId}`;
  }

  function getQueuedShopCount(offer: ShopOfferItem): number {
    const itemKey = getShopItemKey(offer);
    return queuedShopItems.filter((item) => getShopItemKey(item) === itemKey)
      .length;
  }

  function getShopQueueTotal(): number {
    return queuedShopItems.reduce((total, item) => total + item.resourcePrice, 0);
  }

  function showShopError(message: string, title = 'Shop-Hinweis'): void {
    setPendingShopError({ title, message });
  }

  function queueShopOffer(offer: ShopOfferItem): void {
    if (isBuyingShopQueue) return;
    const queuedCount = getQueuedShopCount(offer);
    const queueTotal = getShopQueueTotal();
    if (offer.remainingThisWeek <= 0) {
      showShopError('Der Wochenbestand dieses Angebots ist bereits aufgebraucht.');
      return;
    }
    if (offer.remainingThisWeek - queuedCount <= 0) {
      showShopError('Der Wochenbestand dieses Angebots ist bereits eingeplant.');
      return;
    }
    if (getCrackedEggBalance() < queueTotal + offer.resourcePrice) {
      showShopError('Du hast nicht genug Aufgebrochene Eier für diese Kaufliste.');
      return;
    }
    setQueuedShopItems((items) => [...items, offer]);
  }

  function removeQueuedShopOffer(offer: ShopOfferItem): void {
    const itemKey = getShopItemKey(offer);
    setQueuedShopItems((items) => {
      const removeIndex = items.findIndex((item) => getShopItemKey(item) === itemKey);
      if (removeIndex < 0) return items;
      return items.filter((_, index) => index !== removeIndex);
    });
  }

  function requestQueuedShopPurchase(): void {
    if (isBuyingShopQueue || queuedShopItems.length === 0) return;
    const totalPrice = getShopQueueTotal();
    if (totalPrice > getCrackedEggBalance()) {
      showShopError('Du hast nicht genug Aufgebrochene Eier für diese Kaufliste.');
      return;
    }
    setPendingShopPurchase({
      itemCount: queuedShopItems.length,
      totalPrice
    });
  }

  async function buyQueuedShopItems(): Promise<void> {
    if (isBuyingShopQueue || queuedShopItems.length === 0) return;

    setIsBuyingShopQueue(true);
    try {
      const response = await fetch('/api/game/shop/buy-batch', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: queuedShopItems.map((item) => ({
            kind: item.kind,
            typeId: item.typeId
          }))
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        inventory?: PlayerInventory;
        shop?: ShopOffers;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Shop-Kauf fehlgeschlagen.');
      }
      if (payload?.inventory) setPlayerInventory(payload.inventory);
      else await refreshOwnInventory();
      if (payload?.shop) setShopOffers(payload.shop);
      else await loadShop();
      setQueuedShopItems([]);
      setPendingShopPurchase(null);
      showGameMessage(`${queuedShopItems.length} Shop-Item(s) gekauft.`);
    } catch (error) {
      setPendingShopPurchase(null);
      showShopError(
        error instanceof Error ? error.message : 'Shop-Kauf fehlgeschlagen.',
        'Shop-Kauf fehlgeschlagen'
      );
    } finally {
      setIsBuyingShopQueue(false);
    }
  }

  function requestInventoryRowUpgrade(
    inventoryKind: string,
    title: string,
    newSlotCount: number,
    cost: number
  ): void {
    if (upgradingInventoryKind) return;
    setPendingInventoryUpgrade({ inventoryKind, title, newSlotCount, cost });
  }

  async function upgradeInventoryRow(inventoryKind: string): Promise<void> {
    if (upgradingInventoryKind) return;
    setUpgradingInventoryKind(inventoryKind);
    try {
      const response = await fetch('/api/game/inventory/upgrade-row', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryKind })
      });
      const payload = (await response.json().catch(() => null)) as {
        inventory?: PlayerInventory;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.message ?? 'Inventar-Erweiterung fehlgeschlagen.'
        );
      }
      if (payload?.inventory) setPlayerInventory(payload.inventory);
      else await refreshOwnInventory();
      setPendingInventoryUpgrade(null);
    } finally {
      setUpgradingInventoryKind(null);
    }
  }

  function requestEquipmentSetUpgrade(
    upgradeKind: 'equipment-set-slots' | 'additional-equipment-set',
    title: string,
    description: string,
    cost: number
  ): void {
    if (upgradingInventoryKind) return;
    setPendingEquipmentSetUpgrade({ upgradeKind, title, description, cost });
  }

  async function buyEquipmentSetUpgrade(
    upgradeKind: 'equipment-set-slots' | 'additional-equipment-set'
  ): Promise<void> {
    if (upgradingInventoryKind) return;
    setUpgradingInventoryKind(upgradeKind);
    const endpoint =
      upgradeKind === 'equipment-set-slots'
        ? '/api/game/equipment-sets/upgrade-slots'
        : '/api/game/equipment-sets/buy';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const payload = (await response.json().catch(() => null)) as {
        inventory?: PlayerInventory;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.message ?? 'Ausrüstungsset-Erweiterung fehlgeschlagen.'
        );
      }
      if (payload?.inventory) setPlayerInventory(payload.inventory);
      else await refreshOwnInventory();
      setPendingEquipmentSetUpgrade(null);
    } finally {
      setUpgradingInventoryKind(null);
    }
  }

  async function discardInventoryItem(
    target: InventoryDiscardTarget
  ): Promise<void> {
    const endpointByKind: Record<InventoryDiscardKind, string> = {
      egg: '/api/game/inventory/egg-slots/discard',
      consumable: '/api/game/inventory/consumable-slots/discard',
      equipment: '/api/game/inventory/equipment-slots/discard'
    };
    const idKeyByKind: Record<InventoryDiscardKind, string> = {
      egg: 'unhatchedEggId',
      consumable: 'consumableSlotId',
      equipment: 'equipmentSlotId'
    };
    await postInventoryAction(endpointByKind[target.kind], {
      [idKeyByKind[target.kind]]: target.id,
      confirm: true
    });
  }

  function isInventoryDiscardKind(
    kind: SelectionPayload['kind']
  ): kind is InventoryDiscardKind {
    return (
      kind === 'egg' ||
      kind === 'consumable' ||
      kind === 'equipment'
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
    return 'dieses Objekt';
  }

  function requestSubscriberShopPurchase(offer: SubscriberShopOfferItem): void {
    if (isBuyingSubscriberShopOffer) return;
    if (offer.remainingThisMonth <= 0) {
      showShopError('Der Monatsbestand dieses Angebots ist bereits aufgebraucht.');
      return;
    }
    if (getVoucherBalance() < offer.resourcePrice) {
      showShopError('Du hast nicht genug Gutscheine für dieses Angebot.');
      return;
    }
    setPendingSubscriberShopPurchase({ offer });
  }

  async function buySubscriberShopOffer(offer: SubscriberShopOfferItem): Promise<void> {
    if (isBuyingSubscriberShopOffer) return;

    setIsBuyingSubscriberShopOffer(true);
    try {
      const response = await fetch('/api/game/subscriber-shop/buy', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ petSpeciesId: offer.petSpeciesId, hatId: offer.hatId })
      });
      const payload = (await response.json().catch(() => null)) as {
        inventory?: PlayerInventory;
        shop?: ShopOffers;
        subscriberShop?: SubscriberShopOffers;
        message?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.message ?? 'Subscriber-Shop-Kauf fehlgeschlagen.');
      if (payload?.inventory) setPlayerInventory(payload.inventory);
      else await refreshOwnInventory();
      if (payload?.shop) setShopOffers(payload.shop);
      if (payload?.subscriberShop) setSubscriberShopOffers(payload.subscriberShop);
      else await loadSubscriberShop();
      setPendingSubscriberShopPurchase(null);
      showGameMessage(`${offer.displayName} gekauft.`);
    } catch (error) {
      showShopError(error instanceof Error ? error.message : 'Subscriber-Shop-Kauf fehlgeschlagen.');
    } finally {
      setIsBuyingSubscriberShopOffer(false);
    }
  }

  function showGameMessage(text: string, tone: ToastTone = 'default'): void {
    toastIdRef.current += 1;
    setToastMessage({ id: toastIdRef.current, text, tone });
  }

  function showMysteryEggResult(
    eggTypeId: string,
    result: MysteryEggIdentifyResponse
  ): void {
    const eggLabel = formatMysteryEggType(eggTypeId);
    if (result.result === 'resources') {
      showGameMessage(
        `${eggLabel} bestimmt: ${result.resourceAmount} ${formatEggResourceType(
          result.resourceType
        )} erhalten.`
      );
      return;
    }
    showGameMessage(`${eggLabel} bestimmt: Ein Ei ist jetzt bereit für den Inkubator.`);
  }

  function showIncubationResult(result: IncubationFinishResponse): void {
    const pet = result.pet;
    showGameMessage(
      `Geschlüpft: ${pet.speciesDisplayName} (${pet.rarityLabelDe})!`,
      getToastToneForRarity(pet.rarityId)
    );
  }

  function showGameError(error: unknown): void {
    showGameMessage(
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
    targetKind: 'incubator' | 'egg' | 'pet' | 'consumable' | 'equipment' | 'equipment-set' | 'hat',
    slotIndex: number,
    targetIncubatorId?: string
  ): Promise<void> {
    const payload = selectedPayload;
    setSelectedPayload(null);
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
      if (payload.kind === 'egg' && targetKind === 'egg')
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
    } catch (error) {
      showGameError(error);
    }
  }

  function selectOrRun(
    payload: SelectionPayload,
    targetKind: 'incubator' | 'egg' | 'pet' | 'consumable' | 'equipment' | 'equipment-set' | 'hat',
    slotIndex: number,
    targetIncubatorId?: string
  ): void {
    if (selectedPayload) {
      void handleDropToSlot(targetKind, slotIndex, targetIncubatorId);
      return;
    }
    setSelectedPayload(payload);
    if (payload.kind === 'egg') {
      showGameMessage('Inkubator oder Ziel-Slot antippen. Aktionen oben rechts nutzen.');
    } else if (payload.kind === 'pet') {
      showGameMessage('Event-Slot oder Ziel-Slot antippen. Aktionen oben rechts nutzen.');
    } else if (payload.kind === 'equipment' || payload.kind === 'equipment-set') {
      showGameMessage('Set-Slot oder Ausrüstungsinventar antippen. Aktionen oben rechts nutzen.');
    } else {
      showGameMessage('Ziel-Slot antippen oder Aktionen oben rechts nutzen.');
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
    eggTypeId: string,
    amount: 1 | 5 | 10
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
          amount
        })
      }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Test-Mystery-Eier konnten nicht vergeben werden.'
      );
    }
    await loadInventory(userId);
    await loadLedger(userId);
  }

  async function grantTestEggsToAll(
    eggTypeId: string,
    amount: 1 | 5 | 10
  ): Promise<void> {
    const response = await fetch('/api/admin/grant-test-mystery-eggs/all', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        eggTypeId,
        amount
      })
    });
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      targetUserCount?: number;
    } | null;
    if (!response.ok) {
      throw new Error(
        payload?.message ?? 'Test-Mystery-Eier konnten nicht an alle vergeben werden.'
      );
    }
    window.alert(
      `${amount} Test-Ei(er) an ${payload?.targetUserCount ?? 0} Spieler vergeben.`
    );
    if (selectedUserId) {
      await loadInventory(selectedUserId);
      await loadLedger(selectedUserId);
    } else {
      await loadLedger();
    }
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

  async function loadAdminEggTypes(): Promise<void> {
    const response = await fetch('/api/admin/egg-types/active', {
      credentials: 'include'
    });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      activeEggTypes: AdminEggType[];
    };
    setAdminEggTypes(payload.activeEggTypes);
    if (
      payload.activeEggTypes.length > 0 &&
      !payload.activeEggTypes.some(
        (eggType) => eggType.id === selectedAdminEggTypeId
      )
    ) {
      setSelectedAdminEggTypeId(payload.activeEggTypes[0]!.id);
    }
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
      setSelectedPayload(null);
      showGameMessage(
        isFavorite
          ? 'Pet als Favorit markiert.'
          : 'Pet ist kein Favorit mehr.'
      );
    } catch (error) {
      showGameError(error);
    }
  }

  async function setPetNickname(petId: string, nickname: string): Promise<void> {
    const response = await fetch(`/api/game/pets/${petId}/nickname`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message ?? 'Name konnte nicht aktualisiert werden.'
      );
    }
  }

  async function trainPet(targetPetId: string, consumedPetIds: string[]): Promise<void> {
    const response = await fetch(`/api/game/pets/${targetPetId}/train`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consumedPetIds })
    });

    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      inventory?: PlayerInventory;
    } | null;

    if (!response.ok) {
      throw new Error(payload?.message ?? 'Training konnte nicht gespeichert werden.');
    }

    if (payload?.inventory) setPlayerInventory(payload.inventory);
  }

  async function confirmPetTraining(): Promise<void> {
    if (!trainingDialog || isTrainingSubmitting || trainingDialog.selectedIds.length === 0) return;

    setIsTrainingSubmitting(true);
    try {
      await trainPet(trainingDialog.target.id, trainingDialog.selectedIds);
      setTrainingDialog(null);
      setSelectedPayload(null);
      showGameMessage('Pet-Training abgeschlossen.');
    } catch (error) {
      showGameError(error);
    } finally {
      setIsTrainingSubmitting(false);
    }
  }

  async function confirmPetRename(): Promise<void> {
    if (!renamePetDraft || isPetRenameSubmitting) return;

    setIsPetRenameSubmitting(true);
    try {
      await setPetNickname(renamePetDraft.petId, renamePetDraft.nickname);
      setRenamePetDraft(null);
      await refreshOwnInventory();
      setSelectedPayload(null);
      showGameMessage('Pet wurde umbenannt.');
    } catch (error) {
      showGameError(error);
    } finally {
      setIsPetRenameSubmitting(false);
    }
  }

  async function handleDropToEventPetSlot(): Promise<void> {
    const payload = selectedPayload;
    setSelectedPayload(null);
    if (!payload || payload.kind !== 'pet') return;

    try {
      await setEventPetSelection(payload.id, true);
      await refreshOwnInventory();
      showGameMessage('Event-Pet ausgewählt.');
    } catch (error) {
      showGameError(error);
    }
  }

  async function handleDeselectEventPet(petId: string): Promise<void> {
    try {
      await setEventPetSelection(petId, false);
      await refreshOwnInventory();
      showGameMessage('Event-Pet abgewählt.');
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
      showGameMessage(selectedForEvent ? 'Event-Set ausgewählt.' : 'Event-Set abgewählt.');
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
    if (!toastMessage) return;
    const timeoutId = window.setTimeout(() => {
      setToastMessage((current) =>
        current?.id === toastMessage.id ? null : current
      );
    }, 4500);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

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
        <div className="app-shell app-shell--single">
          <main className="app-scroll container">
            <section className="card">
              <h2>Adminbereich</h2>
              <p>Zugriff verweigert.</p>
            </section>
          </main>
        </div>
      );
    const selected = users.find((x) => x.id === selectedUserId) ?? null;

    return (
      <div className="app-shell app-shell--single">
        <main className="app-scroll container">
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
          <h2>Debug: Eier an alle Spieler</h2>
          <p>Vergibt Test-Eier serverseitig an alle nicht gelöschten Spieler und schreibt Ledger-Einträge.</p>
          <label>
            Ei-Typ:{' '}
            <select
              value={selectedAdminEggTypeId}
              onChange={(event) => setSelectedAdminEggTypeId(event.target.value)}
            >
              {adminEggTypes.map((eggType) => (
                <option key={eggType.id} value={eggType.id}>
                  {eggType.displayName} ({eggType.id})
                </option>
              ))}
            </select>
          </label>
          <div>
            {DEBUG_EGG_GRANT_AMOUNTS.map((amount) => (
              <button
                key={`all:${amount}`}
                disabled={adminEggTypes.length === 0}
                onClick={() =>
                  void grantTestEggsToAll(selectedAdminEggTypeId, amount)
                }
              >
                +{amount} Ei{amount === 1 ? '' : 'er'} an alle
              </button>
            ))}
          </div>
          {adminEggTypes.length === 0 ? (
            <p>Keine aktiven Ei-Typen geladen.</p>
          ) : null}
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
                <label>
                  Debug-Ei-Typ:{' '}
                  <select
                    value={selectedAdminEggTypeId}
                    onChange={(event) =>
                      setSelectedAdminEggTypeId(event.target.value)
                    }
                  >
                    {adminEggTypes.map((eggType) => (
                      <option key={eggType.id} value={eggType.id}>
                        {eggType.displayName} ({eggType.id})
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  {DEBUG_EGG_GRANT_AMOUNTS.map((amount) => (
                    <button
                      key={`selected:${amount}`}
                      disabled={adminEggTypes.length === 0}
                      onClick={() =>
                        void grantTestEgg(
                          selected.id,
                          selectedAdminEggTypeId,
                          amount
                        )
                      }
                    >
                      +{amount} Ei{amount === 1 ? '' : 'er'} an Spieler
                    </button>
                  ))}
                </div>
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
          <h2>Twitch Setup & Integration</h2>
          <button onClick={() => void loadSetupStatus()}>Setup-Status laden</button>
          <button onClick={() => void postSetupAction('/api/setup/health-check')}>Health Check</button>
          <button onClick={() => void postSetupAction('/api/setup/resync-eventsub')}>EventSub Resync</button>
          <button onClick={() => void postSetupAction('/api/setup/run-backfill')}>Backfill fortsetzen</button>
          <a href="/api/setup/twitch/login">Broadcaster reauthentifizieren</a>
          {setupStatus ? (
            <>
              <p>Setup: {setupStatus.completed ? '✅ vollständig' : '❌ unvollständig'}</p>
              <p>Reauth: {setupStatus.requiresReauth ? 'erforderlich' : 'nein'}</p>
              <p>Broadcaster: {setupStatus.broadcaster?.login ?? setupStatus.broadcaster?.userId ?? '—'}</p>
              <p>Scopes fehlen: {setupStatus.missingScopes.join(', ') || 'keine'}</p>
              <p>Letzter Health Check: {setupStatus.lastHealthCheckAt ? new Date(setupStatus.lastHealthCheckAt).toLocaleString() : '—'}</p>
              {setupStatus.lastError ? <p>Letzter Fehler: {setupStatus.lastError}</p> : null}
              <ul>
                {(setupStatus.eventSub.subscriptions ?? []).map((subscription) => (
                  <li key={subscription.eventType}>{subscription.eventType}: {subscription.status}</li>
                ))}
              </ul>
              <h3>Backfill-Läufe</h3>
              <ul>
                {setupStatus.lastBackfillRuns.map((run) => (
                  <li key={run.id}>{run.type}: {run.status} · {run.source}{run.error ? ` · ${run.error}` : ''}</li>
                ))}
              </ul>
            </>
          ) : <p>Noch kein Setup-Status geladen.</p>}
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
                    !['admin_test_mystery_egg_grant', 'duplicate_pet_training'].includes(entry.eventType)
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
      </div>
    );
  }


  function renderSetupScreen(): JSX.Element {
    const status = setupStatus;
    const eventSubs = status?.eventSub.subscriptions ?? [];
    return (
      <div className="app-shell app-shell--single">
        <main className="app-scroll container">
          <header className="hero">
          <p className="badge">Ersteinrichtung · Twitch</p>
          <h1>Erwin Hatchery einrichten</h1>
          <p>Twitch-abhängige Admin- und Spielfunktionen sind gesperrt, bis die Einrichtung abgeschlossen ist.</p>
        </header>
        <section className="card">
          <h2>1. Broadcaster verbinden</h2>
          <p>Bitte melde den konfigurierten Broadcaster-Account an. Die Anmeldung fordert Abos, Channel-Point-Rewards und Bits-Berechtigungen an.</p>
          <p><strong>Wichtig:</strong> Twitch stellt keinen vollständigen historischen EventSub-Replay bereit.</p>
          <p>Backfill importiert aktuell sichtbare Abos und Bits-Leaderboard-Werte bestmöglich.</p>
          <a href="/api/setup/twitch/login">Broadcaster mit Twitch verbinden</a>
          {status?.broadcaster ? <p>Verbunden: {status.broadcaster.login ?? status.broadcaster.userId}</p> : null}
          {status?.requiresReauth ? <p>⚠ Reauth erforderlich.</p> : null}
        </section>
        <section className="card">
          <h2>2. Status & Reparatur</h2>
          <p>Setup: {status?.completed ? '✅ Vollständig' : '❌ Unvollständig'}</p>
          <p>Fehlende Scopes: {status?.missingScopes.length ? status.missingScopes.join(', ') : 'keine'}</p>
          <p>EventSub: {status?.eventSub.enabled ? '✅ aktiv' : '⚠ nicht vollständig aktiv'}</p>
          <p>Abo-Backfill: {status?.subscriptionBackfillCompletedAt ? new Date(status.subscriptionBackfillCompletedAt).toLocaleString() : 'offen'}</p>
          <p>Bits-Backfill: {status?.bitsBackfillCompletedAt ? new Date(status.bitsBackfillCompletedAt).toLocaleString() : 'offen'}</p>
          {status?.lastError ? <p>Letzter Twitch-Fehler: {status.lastError}</p> : null}
          <div>
            <button onClick={() => void postSetupAction('/api/setup/health-check')}>Health Check ausführen</button>
            <button onClick={() => void postSetupAction('/api/setup/resync-eventsub')}>EventSub neu synchronisieren</button>
            <button onClick={() => void postSetupAction('/api/setup/run-backfill')}>Backfill fortsetzen</button>
          </div>
          {eventSubs.length > 0 ? (
            <ul>
              {eventSubs.map((subscription) => (
                <li key={subscription.eventType}>{subscription.eventType}: {subscription.status}{subscription.lastError ? ` · ${subscription.lastError}` : ''}</li>
              ))}
            </ul>
          ) : null}
        </section>
        </main>
      </div>
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

  function findInventoryItem(payload: SelectionPayload | null): EggItem | PetItem | ConsumableItem | EquipmentItem | HatItem | null {
    if (!payload || !playerInventory) return null;
    if (payload.kind === 'egg') {
      return playerInventory.unhatchedEggs.slots.find((cell) => cell.item?.id === payload.id)?.item ?? null;
    }
    if (payload.kind === 'pet') {
      return playerInventory.pets.slots.find((cell) => cell.item?.id === payload.id)?.item ?? null;
    }
    if (payload.kind === 'consumable') {
      return playerInventory.consumables.slots.find((cell) => cell.item?.id === payload.id)?.item ?? null;
    }
    if (payload.kind === 'equipment') {
      return playerInventory.equipment.slots.find((cell) => cell.item?.id === payload.id)?.item ?? null;
    }
    if (payload.kind === 'equipment-set') {
      for (const set of playerInventory.equipmentSets) {
        const item = set.slots.find((slot) => slot.item?.id === payload.id)?.item;
        if (item) return item;
      }
      return null;
    }
    return playerInventory.hats.slots.find((cell) => cell.item?.id === payload.id)?.item ?? null;
  }

  function getSelectedPet(): PetItem | null {
    const item = findInventoryItem(selectedPayload);
    return selectedPayload?.kind === 'pet' && item ? (item as PetItem) : null;
  }

  function getInventoryItemLabel(payload: SelectionPayload | null): string {
    const item = findInventoryItem(payload);
    if (!payload || !item) return 'Ausgewähltes Objekt';
    if (payload.kind === 'egg') return formatMysteryEggType((item as EggItem).eggTypeId);
    if (payload.kind === 'pet') {
      const pet = item as PetItem;
      return pet.nickname ?? pet.speciesDisplayName;
    }
    if (payload.kind === 'consumable') return (item as ConsumableItem).consumableTypeId;
    if (payload.kind === 'equipment' || payload.kind === 'equipment-set') return (item as EquipmentItem).equipmentTypeId;
    return (item as HatItem).hatId;
  }

  function renderStatsRows(payload: SelectionPayload): JSX.Element {
    const item = findInventoryItem(payload);
    if (!item) return <p>Dieses Objekt ist nicht mehr im Inventar.</p>;

    if (payload.kind === 'pet') {
      const pet = item as PetItem;
      return (
        <dl className="stats-grid">
          <div><dt>Art</dt><dd>{pet.speciesDisplayName}</dd></div>
          <div><dt>Spitzname</dt><dd>{pet.nickname ?? '—'}</dd></div>
          <div><dt>Seltenheit</dt><dd>{pet.rarityLabelDe}</dd></div>
          <div><dt>Klasse</dt><dd>{pet.classLabelDe}</dd></div>
          <div><dt>Hauptstat</dt><dd>{pet.classMainStat}</dd></div>
          <div><dt>Nebenstats</dt><dd>{pet.classSecondaryStatOne} · {pet.classSecondaryStatTwo}</dd></div>
          <div><dt>Element</dt><dd>{pet.elementLabelDe}</dd></div>
          <div><dt>Fähigkeit</dt><dd>{pet.abilityLabelDe}</dd></div>
          <div><dt>Level</dt><dd>{pet.level}</dd></div>
          <div><dt>Trainingspunkte</dt><dd>{pet.trainingPoints}</dd></div>
          <div><dt>Training</dt><dd>{pet.trainingProgress.pointsRequiredForNextLevel === null ? 'Max-Level erreicht' : `${pet.trainingProgress.pointsIntoCurrentLevel}/${pet.trainingProgress.pointsRequiredForNextLevel} bis Level ${pet.level + 1}`}</dd></div>
          <div><dt>Favorit</dt><dd>{pet.isFavorite ? 'Ja' : 'Nein'}</dd></div>
          <div><dt>Event-Pet</dt><dd>{pet.selectedForEvent ? 'Ja' : 'Nein'}</dd></div>
          {PET_STAT_IDS.map((stat) => (
            <div key={stat}>
              <dt>{stat}</dt>
              <dd>Basis {petBaseStatValue(pet, stat)} · Bonus +{petLevelBonusValue(pet, stat)} · Effektiv {petEffectiveStatValue(pet, stat)}</dd>
            </div>
          ))}
          <div><dt>Traits</dt><dd>{pet.traits.length > 0 ? pet.traits.map((trait) => trait.labelDe).join(', ') : '—'}</dd></div>
        </dl>
      );
    }

    if (payload.kind === 'egg') {
      const egg = item as EggItem;
      return (
        <dl className="stats-grid">
          <div><dt>Typ</dt><dd>{formatMysteryEggType(egg.eggTypeId)}</dd></div>
          <div><dt>Status</dt><dd>{egg.state}</dd></div>
          <div><dt>ID</dt><dd>{egg.id}</dd></div>
        </dl>
      );
    }

    if (payload.kind === 'consumable') {
      const consumable = item as ConsumableItem;
      return (
        <dl className="stats-grid">
          <div><dt>Typ</dt><dd>{consumable.consumableTypeId}</dd></div>
          <div><dt>Menge</dt><dd>{consumable.quantity}</dd></div>
          <div><dt>ID</dt><dd>{consumable.id}</dd></div>
        </dl>
      );
    }

    if (payload.kind === 'equipment' || payload.kind === 'equipment-set') {
      const equipment = item as EquipmentItem;
      return (
        <dl className="stats-grid">
          <div><dt>Typ</dt><dd>{equipment.equipmentTypeId}</dd></div>
          <div><dt>Status</dt><dd>{payload.kind === 'equipment-set' ? 'Im Set' : 'Im Inventar'}</dd></div>
          <div><dt>ID</dt><dd>{equipment.id}</dd></div>
        </dl>
      );
    }

    const hat = item as HatItem;
    return (
      <dl className="stats-grid">
        <div><dt>Typ</dt><dd>{hat.labelDe}</dd></div>
        <div><dt>Status</dt><dd>{hat.unlocked ? 'Freigeschaltet' : 'Gesperrt'}</dd></div>
        <div><dt>Beschreibung</dt><dd>{hat.description || 'Kosmetischer Hut ohne Stat-Effekt.'}</dd></div>
        <div><dt>ID</dt><dd>{hat.id}</dd></div>
      </dl>
    );
  }

  function showSelectedPayloadStats(): void {
    if (!selectedPayload) return;

    setStatsPayload(selectedPayload);
    setSelectedPayload(null);
  }

  function startSelectedPetRename(selectedPet: PetItem | null): void {
    if (!selectedPet) return;

    setRenamePetDraft({
      petId: selectedPet.id,
      nickname: selectedPet.nickname ?? selectedPet.speciesDisplayName
    });
    setSelectedPayload(null);
  }

  function recycleSelectedPayload(): void {
    if (!selectedPayload) return;
    if (selectedPayload.kind === 'pet') {
      const pet = getSelectedPet();
      if (pet?.isFavorite) {
        showGameMessage('Favoriten können nicht recycelt werden. Entferne zuerst den Favoritenstatus.');
        return;
      }
      setPendingPetScrap({
        petId: selectedPayload.id,
        label: pet?.nickname ?? pet?.speciesDisplayName ?? 'dieses Pet',
        rarity: pet?.rarityLabelDe ?? 'unbekannt'
      });
      setSelectedPayload(null);
      return;
    }
    if (isInventoryDiscardKind(selectedPayload.kind)) {
      const discardTarget = { kind: selectedPayload.kind, id: selectedPayload.id };
      setPendingInventoryDiscard({
        ...discardTarget,
        label: getInventoryDiscardLabel(discardTarget)
      });
      setSelectedPayload(null);
    }
  }

  function renderInventoryControlCenter(
    kind: Exclude<SelectionPayload['kind'], 'incubator'>
  ): JSX.Element {
    const isSelectedHere = selectedPayload?.kind === kind;
    const selectedPet = isSelectedHere && kind === 'pet' ? getSelectedPet() : null;
    const recycleDisabled = !isSelectedHere || kind === 'hat' || selectedPet?.isFavorite === true;
    return (
      <div className="inventory-control-center" aria-label="Inventar-Steuerung">
        <button
          type="button"
          disabled={recycleDisabled}
          onClick={recycleSelectedPayload}
          title={selectedPet?.isFavorite ? 'Favoriten können nicht recycelt werden' : 'Ausgewähltes Objekt recyceln'}
          aria-label={selectedPet?.isFavorite ? 'Favoriten können nicht recycelt werden' : 'Ausgewähltes Objekt recyceln'}
        >
          ♻
        </button>
        <button
          type="button"
          disabled={!isSelectedHere}
          onClick={showSelectedPayloadStats}
          title="Werte anzeigen"
          aria-label="Werte anzeigen"
        >
          📊
        </button>
        {kind === 'pet' ? (
          <>
            <button
              type="button"
              disabled={!selectedPet}
              onClick={() => {
                if (selectedPet) void handlePetFavoriteToggle(selectedPet.id, !selectedPet.isFavorite);
              }}
              title={selectedPet?.isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
              aria-label={selectedPet?.isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
            >
              ★
            </button>
            <button
              type="button"
              disabled={!selectedPet}
              onClick={() => startSelectedPetRename(selectedPet)}
              title="Pet umbenennen"
              aria-label="Pet umbenennen"
            >
              ✎
            </button>
          </>
        ) : null}
      </div>
    );
  }

  function renderShopPanel(shop: ShopOffers | null): JSX.Element {
    const crackedEggBalance = getCrackedEggBalance();
    const queueTotal = getShopQueueTotal();
    const weekEndsAt = shop
      ? new Date(shop.weekEndsAt).toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        })
      : '—';
    const groupedOffers: Array<{
      kind: ShopOfferKind;
      title: string;
      folder: SlotAssetFolder;
    }> = [
      { kind: 'consumable', title: 'Verbrauchbares', folder: 'consumables' },
      { kind: 'equipment', title: 'Ausrüstung', folder: 'equipment' }
    ];
    const groupedQueuedShopItems = queuedShopItems.reduce<
      Array<{
        key: string;
        item: ShopOfferItem;
        quantity: number;
        totalPrice: number;
      }>
    >((groups, item) => {
      const itemKey = getShopItemKey(item);
      const existingGroup = groups.find((group) => group.key === itemKey);
      if (existingGroup) {
        existingGroup.quantity += 1;
        existingGroup.totalPrice += item.resourcePrice;
      } else {
        groups.push({
          key: itemKey,
          item,
          quantity: 1,
          totalPrice: item.resourcePrice
        });
      }
      return groups;
    }, []);

    return (
      <section className="inventory-panel shop-panel">
        <div className="inventory-panel-header">
          <div>
            <h3>Shop</h3>
            <p className="inventory-capacity">Wechsel am {weekEndsAt}</p>
          </div>
        </div>
        {!shop ? (
          <p>Shop wird geladen…</p>
        ) : shop.offers.length === 0 ? (
          <p>Diese Woche gibt es keine kaufbaren Angebote.</p>
        ) : (
          <>
            <div className="shop-offer-rows">
              {groupedOffers.map((group) => {
                const offers = shop.offers.filter((offer) => offer.kind === group.kind);
                return (
                  <div key={group.kind} className="shop-offer-row-block">
                    <h4>{group.title}</h4>
                    <div className="shop-offer-row">
                      {offers.length === 0 ? (
                        <p className="shop-empty-row">Keine Angebote.</p>
                      ) : (
                        offers.map((offer) => {
                          const itemKey = getShopItemKey(offer);
                          const queuedCount = getQueuedShopCount(offer);
                          const remainingAfterQueue = offer.remainingThisWeek - queuedCount;
                          const isSoldOut = offer.remainingThisWeek <= 0;
                          const isQueuedOut = remainingAfterQueue <= 0;
                          const isTooExpensive =
                            crackedEggBalance < queueTotal + offer.resourcePrice;
                          return (
                            <article
                              key={itemKey}
                              className={`shop-offer-card ${queuedCount > 0 ? 'queued' : ''}`}
                            >
                              {queuedCount > 0 ? (
                                <span className="shop-queue-badge">×{queuedCount}</span>
                              ) : null}
                              <button
                                type="button"
                                className="shop-offer-action shop-offer-add"
                                onClick={() => queueShopOffer(offer)}
                                disabled={
                                  isBuyingShopQueue ||
                                  isSoldOut ||
                                  isQueuedOut ||
                                  isTooExpensive
                                }
                                title={
                                  isSoldOut || isQueuedOut
                                    ? 'Wochenbestand aufgebraucht'
                                    : isTooExpensive
                                      ? 'Nicht genug Aufgebrochene Eier für die Auswahl'
                                      : 'Zur Kaufliste hinzufügen'
                                }
                                aria-label={`${offer.displayName} zur Kaufliste hinzufügen`}
                              >
                                {renderSlotAsset({
                                  folder: group.folder,
                                  assetKey: offer.typeId,
                                  label: offer.displayName,
                                  size: 56,
                                  className: 'shop-offer-asset'
                                })}
                                <strong>{offer.displayName}</strong>
                                <small>
                                  Bestand: {Math.max(0, remainingAfterQueue)}/{offer.stock}
                                </small>
                                <span>{offer.resourcePrice} Eier</span>
                                <span className="shop-offer-symbol" aria-hidden="true">
                                  +
                                </span>
                              </button>
                              <button
                                type="button"
                                className="shop-offer-action shop-offer-remove"
                                onClick={() => removeQueuedShopOffer(offer)}
                                disabled={queuedCount <= 0 || isBuyingShopQueue}
                                title="Aus Kaufliste entfernen"
                                aria-label={`${offer.displayName} aus Kaufliste entfernen`}
                              >
                                <span aria-hidden="true">−</span>
                              </button>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="shop-queue-panel">
              <div>
                <strong>Kaufliste</strong>
                <p>
                  {queuedShopItems.length > 0
                    ? `${queuedShopItems.length} Item(s) · ${queueTotal} Aufgebrochene Eier`
                    : 'Tippe Angebote an, um sie vorzumerken.'}
                </p>
              </div>
              {groupedQueuedShopItems.length > 0 ? (
                <div className="shop-queue-list">
                  {groupedQueuedShopItems.map((group) => (
                    <div key={group.key} className="shop-queue-row">
                      <span className="shop-queue-row-name">{group.item.displayName}</span>
                      <span className="shop-queue-row-quantity">×{group.quantity}</span>
                      <span className="shop-queue-row-price">{group.totalPrice} Eier</span>
                      <button
                        type="button"
                        onClick={() => removeQueuedShopOffer(group.item)}
                        disabled={isBuyingShopQueue}
                        title="Ein Item aus Kaufliste entfernen"
                        aria-label={`${group.item.displayName} einmal aus Kaufliste entfernen`}
                      >
                        −
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={requestQueuedShopPurchase}
                disabled={
                  isBuyingShopQueue ||
                  queuedShopItems.length === 0 ||
                  queueTotal > crackedEggBalance
                }
              >
                {isBuyingShopQueue ? 'Kaufe …' : `Kaufliste kaufen (${queueTotal})`}
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  function renderSubscriberShopPanel(shop: SubscriberShopOffers | null): JSX.Element {
    const voucherBalance = getVoucherBalance();
    const monthEndsAt = shop
      ? new Date(shop.monthEndsAt).toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        })
      : '—';

    return (
      <section className="inventory-panel shop-panel subscriber-shop-panel">
        <div className="inventory-panel-header">
          <div>
            <h3>Subscriber-Shop</h3>
            <p className="inventory-capacity">
              Wechsel am {monthEndsAt} · Du hast {voucherBalance} Gutschein(e)
            </p>
          </div>
        </div>
        {!shop ? (
          <p>Subscriber-Shop wird geladen…</p>
        ) : shop.offers.length === 0 ? (
          <p>Dieser Monat hat keine kaufbaren Pet-Hut-Paare.</p>
        ) : (
          <div className="shop-offer-row subscriber-shop-row">
            {shop.offers.map((offer) => {
              const isSoldOut = offer.remainingThisMonth <= 0;
              const isTooExpensive = voucherBalance < offer.resourcePrice;
              return (
                <button
                  key={`${offer.petSpeciesId}:${offer.hatId}`}
                  type="button"
                  className="shop-offer-card subscriber-shop-card"
                  onClick={() => requestSubscriberShopPurchase(offer)}
                  disabled={isBuyingSubscriberShopOffer}
                  title={
                    isSoldOut
                      ? 'Monatsbestand aufgebraucht'
                      : isTooExpensive
                        ? 'Nicht genug Gutscheine'
                        : 'Pet-Hut-Paar kaufen'
                  }
                >
                  <span className="subscriber-shop-assets" aria-hidden="true">
                    {renderSlotAsset({ folder: 'pets', assetKey: getPetAssetKey(offer.petSpeciesId), label: offer.petDisplayName, size: 56, className: 'shop-offer-asset' })}
                    {renderSlotAsset({ folder: 'hats', assetKey: offer.hatId, label: offer.hatLabelDe, size: 28, className: 'subscriber-shop-hat-asset' })}
                  </span>
                  <strong>{offer.displayName}</strong>
                  <small>Bestand: {offer.remainingThisMonth}/{offer.stock}</small>
                  <span>{offer.resourcePrice} Gutschein</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  function renderGrid<T extends { id: string }>(
    title: string,
    grid: InventoryGrid<T>,
    kind: Exclude<SelectionPayload['kind'], 'incubator'>,
    renderItem: (item: T, slotIndex: number) => JSX.Element,
    className = '',
    getItemClassName?: (item: T) => string
  ): JSX.Element {
    return (
      <section className={`inventory-panel ${className}`}>
        <div className="inventory-panel-header">
          <div>
            <h3>{title}</h3>
            <p className="inventory-capacity">
              {grid.slots.filter((cell) => cell.item).length}/
              {grid.dimensions.capacity} Slots · {grid.dimensions.columns}×
              {grid.dimensions.rows}
            </p>
          </div>
          {renderInventoryControlCenter(kind)}
        </div>
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
              className={`inventory-slot ${cell.item ? 'occupied' : 'empty'} ${kind}-slot ${cell.item && selectedPayload?.kind === kind && selectedPayload.id === cell.item.id ? 'selected-source' : ''} ${cell.item && getItemClassName ? getItemClassName(cell.item) : ''} ${selectedPayload ? 'select-target' : ''}`}
              onClick={() => {
                if (cell.item) {
                  const payload: SelectionPayload = { kind, id: cell.item.id };
                  selectOrRun(payload, kind, cell.slotIndex);
                } else {
                  void handleDropToSlot(kind, cell.slotIndex);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                if (cell.item) {
                  const payload: SelectionPayload = { kind, id: cell.item.id };
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
        {grid.dimensions.nextRowUpgradeCostCrackedEggs !== null ? (
          <button
            type="button"
            className="inventory-upgrade-panel inventory-upgrade-button"
            onClick={() =>
              requestInventoryRowUpgrade(
                grid.dimensions.kind,
                'Inventar erweitern',
                grid.dimensions.columns,
                grid.dimensions.nextRowUpgradeCostCrackedEggs ?? 0
              )
            }
            disabled={
              upgradingInventoryKind !== null ||
              getCrackedEggBalance() <
                grid.dimensions.nextRowUpgradeCostCrackedEggs
            }
          >
            <strong>Inventar erweitern</strong>
            <span>+1 Reihe ({formatUpgradeSlotCount(grid.dimensions.columns)})</span>
            <span>
              {upgradingInventoryKind === grid.dimensions.kind
                ? 'Erweitere …'
                : `${grid.dimensions.nextRowUpgradeCostCrackedEggs} Aufgebrochene Eier`}
            </span>
          </button>
        ) : null}
      </section>
    );
  }

  function renderEquipmentSetsPanel(
    sets: EquipmentSet[],
    upgrades: EquipmentSetUpgrades
  ): JSX.Element {
    const crackedEggBalance = getCrackedEggBalance();
    const isSlotUpgradePending = upgradingInventoryKind === 'equipment-set-slots';
    const isSetBuyPending = upgradingInventoryKind === 'additional-equipment-set';

    return (
      <section className="inventory-panel equipment-set-panel">
        <div className="equipment-set-header">
          <div>
            <h3>Ausrüstungssets</h3>
            <p className="inventory-capacity">Ausrüstung im Set verschwindet aus dem normalen Raster.</p>
          </div>
        </div>
        <div className="equipment-set-upgrade-actions">
          <button
            type="button"
            className="inventory-upgrade-panel inventory-upgrade-button equipment-set-upgrade-button"
            onClick={() =>
              requestEquipmentSetUpgrade(
                'equipment-set-slots',
                'Set-Slots erweitern',
                '+1 Slot für jedes bestehende und zukünftige Set. Das nächste Slot-Upgrade kostet danach doppelt.',
                upgrades.nextSlotUpgradeCostCrackedEggs
              )
            }
            disabled={
              upgradingInventoryKind !== null ||
              crackedEggBalance < upgrades.nextSlotUpgradeCostCrackedEggs
            }
          >
            <strong>Set-Slots erweitern</strong>
            <span>+1 Slot für jedes Set · Du hast {crackedEggBalance} Aufgebrochene Eier</span>
            <span>
              {isSlotUpgradePending
                ? 'Erweitere …'
                : `${upgrades.nextSlotUpgradeCostCrackedEggs} Aufgebrochene Eier`}
            </span>
          </button>
          <button
            type="button"
            className="inventory-upgrade-panel inventory-upgrade-button equipment-set-upgrade-button"
            onClick={() =>
              requestEquipmentSetUpgrade(
                'additional-equipment-set',
                'Weiteres Set kaufen',
                `+1 zusätzliches Ausrüstungsset mit ${
                  DEFAULT_EQUIPMENT_SET_BASE_SLOTS + upgrades.setSlotBonusCount
                } Slots. Der nächste Set-Kauf kostet danach doppelt.`,
                upgrades.nextSetCostCrackedEggs
              )
            }
            disabled={
              upgradingInventoryKind !== null ||
              crackedEggBalance < upgrades.nextSetCostCrackedEggs
            }
          >
            <strong>Weiteres Set kaufen</strong>
            <span>
              +1 zusätzliches Set mit {DEFAULT_EQUIPMENT_SET_BASE_SLOTS + upgrades.setSlotBonusCount}{' '}
              Slots · Du hast {crackedEggBalance} Aufgebrochene Eier
            </span>
            <span>
              {isSetBuyPending
                ? 'Kaufe …'
                : `${upgrades.nextSetCostCrackedEggs} Aufgebrochene Eier`}
            </span>
          </button>
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
                          <small>Ausrüstung antippen, dann Ziel-Slot wählen</small>
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
            <span className="empty-slot-label">Pet auswählen</span>
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

  function renderIncubatorInventory(
    inventory: IncubatorInventory
  ): JSX.Element {
    const incubators = inventory.incubators;
    const upgradeCost = inventory.dimensions.nextRowUpgradeCostCrackedEggs;

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
                  onClick={() => {
                    if (selectedPayload?.kind === 'egg' && canStartEgg) {
                      void handleDropToSlot('incubator', 0, incubator.id);
                    }
                  }}
                  aria-label={`${formatIncubatorSource(incubator.slotSource)} Queue-Slot ${(incubator.slotIndex ?? 0) + 1}`}
                >
                  <div className="slot-content">
                    <strong>
                      {formatIncubatorSource(incubator.slotSource)} #
                      {(incubator.slotIndex ?? 0) + 1}
                    </strong>
                    {active ? (
                      <>
                        <span className="slot-progress">
                          {active.state === 'queued'
                            ? 'Wartet'
                            : active.state === 'completed'
                              ? 'Bereit'
                              : formatRemainingDuration(secondsRemaining ?? 0)}
                        </span>
                        <span className="incubator-slot-note">
                          {active.state === 'queued'
                            ? 'Bis Stream live ist'
                            : active.state === 'completed'
                              ? 'Abholbereit'
                              : 'Nur Live-Zeit'}
                        </span>
                        {(active.state === 'completed' ||
                          (active.state === 'running' &&
                            (secondsRemaining ?? 1) <= 0)) ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void finishIncubation(active.unhatchedEggId)
                                .then(async (result) => {
                                  showIncubationResult(result);
                                  await refreshOwnInventory();
                                })
                                .catch(showGameError);
                            }}
                          >
                            Abholen
                          </button>
                        ) : null}
                      </>
                    ) : canStartEgg ? (
                      <span className="incubator-slot-note">Frei · Ei wählen</span>
                    ) : (
                      <span className="incubator-slot-note">Gesperrt</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p>Keine Inkubatoren verfügbar.</p>
        )}
        {upgradeCost !== null ? (
          <button
            type="button"
            className="inventory-upgrade-panel inventory-upgrade-button"
            onClick={() =>
              requestInventoryRowUpgrade(
                inventory.dimensions.kind,
                'Inkubatoren erweitern',
                inventory.dimensions.columns,
                upgradeCost
              )
            }
            disabled={
              upgradingInventoryKind !== null ||
              getCrackedEggBalance() < upgradeCost
            }
          >
            <strong>Inventar erweitern</strong>
            <span>+1 Reihe ({formatUpgradeSlotCount(inventory.dimensions.columns)})</span>
            <span>
              {upgradingInventoryKind === inventory.dimensions.kind
                ? 'Erweitere …'
                : `${upgradeCost} Aufgebrochene Eier`}
            </span>
          </button>
        ) : null}
      </section>
    );
  }

  function renderResourceSummary(inventory: PlayerInventory): JSX.Element {
    return (
      <div className="resource-summary">
        <h3>Gezählte Vorräte</h3>
        <div className="resource-summary-grid">
          <section
            className="resource-column"
            aria-labelledby="inventory-eggs-title"
          >
            <h4 id="inventory-eggs-title">Eier</h4>
            {inventory.mysteryEggs.filter((entry) => entry.amount > 0).length > 0 ? (
              inventory.mysteryEggs
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
                      <strong>{formatMysteryEggType(entry.eggTypeId)}:</strong>{' '}
                      {entry.amount}
                    </span>{' '}
                    <button
                      type="button"
                      onClick={() =>
                        void identifyMysteryEgg(entry.eggTypeId)
                          .then(async (result) => {
                            showMysteryEggResult(entry.eggTypeId, result);
                            await refreshOwnInventory();
                          })
                          .catch(showGameError)
                      }
                    >
                      Typ bestimmen
                    </button>
                  </p>
                ))
            ) : (
              <p className="resource-empty">Keine Eier.</p>
            )}
          </section>
          <section
            className="resource-column"
            aria-labelledby="inventory-resources-title"
          >
            <h4 id="inventory-resources-title">Ressourcen</h4>
            {inventory.crackedEggResources.filter((entry) => entry.amount > 0).length > 0 ? (
              inventory.crackedEggResources
                .filter((entry) => entry.amount > 0)
                .map((entry) => {
                  const resourceAssetKey = getEggResourceAssetKey(entry.resourceType);

                  return (
                    <p key={entry.resourceType} className="resource-row">
                      {resourceAssetKey
                        ? renderSlotAsset({
                            folder: 'resources',
                            assetKey: resourceAssetKey,
                            label: formatEggResourceType(entry.resourceType),
                            size: 28
                          })
                        : null}
                      <span>
                        <strong>{formatEggResourceType(entry.resourceType)}:</strong>{' '}
                        {entry.amount}
                      </span>
                    </p>
                  );
                })
            ) : (
              <p className="resource-empty">Keine Ressourcen.</p>
            )}
          </section>
        </div>
      </div>
    );
  }

  function renderUnhatchedEggGrid(inventory: PlayerInventory): JSX.Element {
    return renderGrid(
      'Unausgebrütete Eier',
      inventory.unhatchedEggs,
      'egg',
      (egg) => (
        <div className="slot-content slot-content-with-asset">
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
      undefined
    );
  }

  function renderEventBox(inventory: PlayerInventory): JSX.Element {
    const selectedEventPet = inventory.pets.slots.find(
      (slot) => slot.item?.selectedForEvent
    )?.item ?? null;
    const selectedEventSet = inventory.equipmentSets.find(
      (set) => set.selectedForEvent
    );

    return (
      <section className="inventory-panel pet-panel">
        <h3>Event box</h3>
        <p className="inventory-capacity">
          Pet antippen und dann den Event-Slot oder Ziel-Slot wählen.
        </p>
        {renderEventPetSelectionSlot(selectedEventPet)}
        <div className="event-set-summary">
          <span>Event-Set</span>
          <strong>{selectedEventSet?.label ?? 'Kein Set ausgewählt'}</strong>
          <small>
            {selectedEventSet
              ? `${selectedEventSet.slots.filter((slot) => slot.item).length}/${selectedEventSet.slotCount} Slots belegt`
              : 'Optional für Beta-Battles'}
          </small>
        </div>
      </section>
    );
  }

  function getEligibleTrainingDuplicates(target: PetItem): PetItem[] {
    if (!playerInventory) return [];
    return playerInventory.pets.slots
      .map((slot) => slot.item)
      .filter(
        (pet): pet is PetItem =>
          pet !== null &&
          pet.id !== target.id &&
          pet.speciesId === target.speciesId &&
          !pet.isFavorite &&
          !pet.isLocked &&
          !pet.selectedForEvent
      );
  }

  function getTrainingPreview(target: PetItem, selectedIds: string[]): TrainingPreview {
    const selected = getEligibleTrainingDuplicates(target).filter((pet) => selectedIds.includes(pet.id));
    const pointsAwarded = selected.reduce((sum, pet) => sum + consumedPetTrainingValue(pet.level), 0);
    const levelBefore = target.level;
    const levelAfter = trainingLevelForPoints(
      target.trainingPoints + pointsAwarded,
      target.trainingProgress.maxLevel
    );
    const beforeBonus = levelBonusForPet(target, levelBefore);
    const afterBonus = levelBonusForPet(target, levelAfter);
    return {
      pointsAwarded,
      levelBefore,
      levelAfter,
      statChanges: {
        HP: afterBonus.HP - beforeBonus.HP,
        ATK: afterBonus.ATK - beforeBonus.ATK,
        DEF: afterBonus.DEF - beforeBonus.DEF,
        SPD: afterBonus.SPD - beforeBonus.SPD,
        GAIN: afterBonus.GAIN - beforeBonus.GAIN,
        POW: afterBonus.POW - beforeBonus.POW
      }
    };
  }

  function renderTrainingDialog(): JSX.Element | null {
    if (!trainingDialog) return null;
    const eligibleDuplicates = getEligibleTrainingDuplicates(trainingDialog.target);
    const selectedPets = eligibleDuplicates.filter((pet) => trainingDialog.selectedIds.includes(pet.id));
    const preview = getTrainingPreview(trainingDialog.target, trainingDialog.selectedIds);
    const togglePet = (petId: string) => {
      setTrainingDialog((current) => {
        if (!current) return current;
        const selected = new Set(current.selectedIds);
        if (selected.has(petId)) selected.delete(petId);
        else selected.add(petId);
        return { ...current, selectedIds: [...selected] };
      });
    };

    return (
      <PlayerDialog
        id="pet-training"
        title={`${trainingDialog.target.nickname ?? trainingDialog.target.speciesDisplayName} trainieren`}
        variant="info"
        description="Wähle aktive Duplikate derselben Art. Das Training wird vollständig serverseitig berechnet."
        actions={[
          {
            label: isTrainingSubmitting ? 'Trainiert…' : 'Training bestätigen',
            onClick: () => void confirmPetTraining(),
            disabled: isTrainingSubmitting || trainingDialog.selectedIds.length === 0,
            variant: 'primary'
          },
          {
            label: 'Abbrechen',
            onClick: () => setTrainingDialog(null),
            disabled: isTrainingSubmitting,
            variant: 'secondary'
          }
        ]}
        onCancel={() => setTrainingDialog(null)}
        cancelDisabled={isTrainingSubmitting}
      >
        <div className="training-dialog-body">
          <p className="training-warning">
            Achtung: Verbrauchte Pets verschwinden aus deiner aktiven Sammlung und können nicht mehr für Battles genutzt werden.
          </p>
          <div className="training-progress-summary">
            <strong>Fortschritt</strong>
            <span>
              Level {trainingDialog.target.level} · {trainingDialog.target.trainingProgress.pointsRequiredForNextLevel === null
                ? 'Max-Level erreicht'
                : `${trainingDialog.target.trainingProgress.pointsIntoCurrentLevel}/${trainingDialog.target.trainingProgress.pointsRequiredForNextLevel} Punkte bis Level ${trainingDialog.target.level + 1}`}
            </span>
          </div>
          <div className="training-material-list">
            {eligibleDuplicates.length > 0 ? eligibleDuplicates.map((pet) => (
              <label key={pet.id} className="training-material-row">
                <input
                  type="checkbox"
                  checked={trainingDialog.selectedIds.includes(pet.id)}
                  onChange={() => togglePet(pet.id)}
                  disabled={isTrainingSubmitting}
                />
                <span>
                  <strong>{pet.nickname ?? pet.speciesDisplayName}</strong>
                  <small>Level {pet.level} · +{consumedPetTrainingValue(pet.level)} Trainingspunkte</small>
                </span>
              </label>
            )) : <p>Keine geeigneten Duplikate vorhanden.</p>}
          </div>
          <div className="training-preview">
            <strong>Vorschau</strong>
            <span>Verbrauchte Pets: {selectedPets.length > 0 ? selectedPets.map((pet) => pet.nickname ?? pet.speciesDisplayName).join(', ') : '—'}</span>
            <span>Trainingspunkte: +{preview.pointsAwarded}</span>
            <span>Level: {preview.levelBefore} → {preview.levelAfter}</span>
            <span>Stat-Änderungen: {PET_STAT_IDS.map((stat) => `${stat} ${preview.statChanges[stat] >= 0 ? '+' : ''}${preview.statChanges[stat]}`).join(' · ')}</span>
          </div>
        </div>
      </PlayerDialog>
    );
  }

  function renderPetInventoryGrid(inventory: PlayerInventory): JSX.Element {
    return renderGrid(
      'Pet-Inventar',
      inventory.pets,
      'pet',
      (pet) => (
        <div
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
                aria-label={pet.isFavorite ? 'Favorit' : 'Kein Favorit'}
                title={pet.isFavorite ? 'Favorit' : 'Kein Favorit'}
              >
                {pet.isFavorite ? renderEmblemAsset('favorite', 'Favorit') : null}
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
                {renderEmblemAsset(`classes/${pet.classId}`, pet.classLabelDe)}
              </span>
              <span
                className="pet-emblem pet-emblem-element"
                aria-label={pet.elementLabelDe}
                title={pet.elementLabelDe}
              >
                {renderEmblemAsset(`elements/${pet.elementId}`, pet.elementLabelDe)}
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
        `${pet.selectedForEvent ? 'selected-event-pet' : ''} ${getPetRarityClassName(pet.rarityId)}`.trim()
    );
  }

  function renderConsumableGrid(inventory: PlayerInventory): JSX.Element {
    return renderGrid(
      'Verbrauchbares',
      inventory.consumables,
      'consumable',
      (item) => (
        <div className="slot-content slot-content-with-asset">
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
      undefined
    );
  }

  function renderEquipmentGrid(inventory: PlayerInventory): JSX.Element {
    return renderGrid(
      'Ausrüstung',
      inventory.equipment,
      'equipment',
      (equipment) => (
        <div className="slot-content slot-content-with-asset">
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
      undefined
    );
  }

  function renderHatGrid(inventory: PlayerInventory): JSX.Element {
    return (
      <section className="inventory-panel item-panel hat-collection-panel">
        <div className="inventory-panel-header">
          <div>
            <h3>Hüte</h3>
            <p className="inventory-capacity">
              {inventory.hats.unlockedCount}/{inventory.hats.total} freigeschaltet · Sammlung
            </p>
          </div>
          {renderInventoryControlCenter('hat')}
        </div>
        <div
          className="inventory-grid hat-collection-grid"
          style={{
            gridTemplateColumns: `repeat(${inventory.hats.columns}, minmax(0, 1fr))`
          }}
        >
          {inventory.hats.slots.map((cell) => {
            const hat = cell.item;
            return (
              <div
                key={cell.slotIndex}
                role="button"
                tabIndex={0}
                className={`inventory-slot occupied hat-slot hat-collection-slot ${hat.unlocked ? 'hat-unlocked' : 'hat-locked'} ${selectedPayload?.kind === 'hat' && selectedPayload.id === hat.id ? 'selected-source' : ''}`}
                onClick={() => selectOrRun({ kind: 'hat', id: hat.id }, 'hat', cell.slotIndex)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  selectOrRun({ kind: 'hat', id: hat.id }, 'hat', cell.slotIndex);
                }}
                aria-label={`${hat.labelDe} ${hat.unlocked ? 'freigeschaltet' : 'gesperrt'}`}
              >
                <div className="slot-content slot-content-with-asset">
                  {renderSlotAsset({
                    folder: 'hats',
                    assetKey: hat.hatId,
                    label: hat.labelDe,
                    size: 28
                  })}
                  <div className="slot-text">
                    <strong>{hat.labelDe}</strong>
                    <span>{hat.unlocked ? 'Freigeschaltet' : 'Gesperrt'}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function scrollPlayerPageToTop(): void {
    window.requestAnimationFrame(() => {
      const scrollContainer = document.querySelector<HTMLElement>('.app-scroll');
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  function setPlayerPageIndex(pageIndex: number, pageCount: number): void {
    setActivePlayerPageIndex((currentIndex) => {
      const nextIndex = Math.min(Math.max(pageIndex, 0), pageCount - 1);
      if (nextIndex !== currentIndex) scrollPlayerPageToTop();
      return nextIndex;
    });
  }

  function handlePlayerPageSwipeStart(clientX: number, clientY: number): void {
    swipeStartRef.current = { x: clientX, y: clientY };
  }

  function handlePlayerPageSwipeEnd(
    clientX: number,
    clientY: number,
    pageCount: number
  ): void {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;

    const distanceX = clientX - start.x;
    const distanceY = clientY - start.y;
    const absoluteDistanceX = Math.abs(distanceX);
    const absoluteDistanceY = Math.abs(distanceY);

    if (absoluteDistanceX < 84 || absoluteDistanceX < absoluteDistanceY * 1.75) {
      return;
    }

    setActivePlayerPageIndex((currentIndex) => {
      const nextIndex =
        distanceX < 0
          ? Math.min(pageCount - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      if (nextIndex !== currentIndex) scrollPlayerPageToTop();
      return nextIndex;
    });
  }


  if (setupStatus && !setupStatus.completed && !isAlertOverlayRoute && !isBattleOverlayRoute) {
    return renderSetupScreen();
  }

  const playerPages: Array<{ id: string; label: string; icon: string; content: JSX.Element }> = [
    {
      id: 'main',
      label: 'Start',
      icon: '⌂',
      content: (
        <div className="player-page-content">
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
        </div>
      )
    }
  ];

  if (me?.authenticated) {
    if (playerInventory) {
      playerPages.push(
        {
          id: 'incubator',
          label: 'Inkubator',
          icon: '🥚',
          content: (
            <div className="player-page-content inventory-stack">
              {renderResourceSummary(playerInventory)}
              {renderIncubatorInventory(playerInventory.incubators)}
              {renderUnhatchedEggGrid(playerInventory)}
            </div>
          )
        },
        {
          id: 'pets',
          label: 'Pets',
          icon: '🐾',
          content: (
            <div className="player-page-content inventory-stack">
              {renderEventBox(playerInventory)}
              {renderPetInventoryGrid(playerInventory)}
            </div>
          )
        },
        {
          id: 'consumables',
          label: 'Verbrauchbares',
          icon: '✦',
          content: (
            <div className="player-page-content inventory-stack">
              {renderConsumableGrid(playerInventory)}
              {renderPetInventoryGrid(playerInventory)}
            </div>
          )
        },
        {
          id: 'equipment',
          label: 'Ausrüstung',
          icon: '⚔',
          content: (
            <div className="player-page-content inventory-stack">
              {renderEquipmentSetsPanel(
                playerInventory.equipmentSets,
                playerInventory.equipmentSetUpgrades
              )}
              {renderEquipmentGrid(playerInventory)}
            </div>
          )
        },
        {
          id: 'profile',
          label: 'Profil',
          icon: '🎩',
          content: (
            <div className="player-page-content inventory-stack">
              {renderHatGrid(playerInventory)}
            </div>
          )
        },
        {
          id: 'shop',
          label: 'Shop',
          icon: '🛒',
          content: (
            <div className="player-page-content inventory-stack">
              {renderShopPanel(shopOffers)}
              {renderSubscriberShopPanel(subscriberShopOffers)}
            </div>
          )
        }
      );
    } else {
      playerPages.push({
        id: 'loading',
        label: 'Spiel',
        icon: '…',
        content: (
          <section className="card player-page-content">
            <h2>Spielbereich</h2>
            <p>Inventar wird geladen…</p>
          </section>
        )
      });
    }
  }

  const currentPlayerPageIndex = Math.min(
    activePlayerPageIndex,
    playerPages.length - 1
  );
  const goToPlayerPage = (pageIndex: number): void => {
    setPlayerPageIndex(pageIndex, playerPages.length);
  };

  return (
    <div className="app-shell">
      <main className="app-scroll container player-page-container">
      {me?.authenticated && playerInventory ? (
        <>
{pendingPetScrap ? (
  <PlayerDialog
    id="pet-scrap-confirm"
    title={`${pendingPetScrap.label} wirklich verwerten?`}
    role="alertdialog"
    description={
      <>
        Dieses Pet wird dauerhaft gelöscht und du erhältst
        Aufgebrochene Eier abhängig von der Seltenheit (
        {pendingPetScrap.rarity}).
      </>
    }
    actions={[
      {
        label: isPetScrapSubmitting
          ? 'Wird verwertet …'
          : 'Ja, verwerten',
        onClick: () => void confirmPetScrap(),
        disabled: isPetScrapSubmitting,
        variant: 'primary'
      },
      {
        label: 'Abbrechen',
        onClick: () => setPendingPetScrap(null),
        disabled: isPetScrapSubmitting,
        variant: 'secondary'
      }
    ]}
    onCancel={() => setPendingPetScrap(null)}
    cancelDisabled={isPetScrapSubmitting}
  />
) : null}
{pendingInventoryDiscard ? (
  <PlayerDialog
    id="inventory-discard-confirm"
    title={`${pendingInventoryDiscard.label} wirklich verwerfen?`}
    role="alertdialog"
    description="Der Gegenstand wird dauerhaft gelöscht. Du erhältst dafür keine Ressourcen oder andere Belohnungen."
    actions={[
      {
        label: isInventoryDiscardSubmitting
          ? 'Wird verworfen …'
          : 'Ja, verwerfen',
        onClick: () => void confirmInventoryDiscard(),
        disabled: isInventoryDiscardSubmitting,
        variant: 'primary'
      },
      {
        label: 'Abbrechen',
        onClick: () => setPendingInventoryDiscard(null),
        disabled: isInventoryDiscardSubmitting,
        variant: 'secondary'
      }
    ]}
    onCancel={() => setPendingInventoryDiscard(null)}
    cancelDisabled={isInventoryDiscardSubmitting}
  />
) : null}
{pendingShopError ? (
  <PlayerDialog
    id="shop-error-dialog"
    title={pendingShopError.title}
    role="alertdialog"
    variant="info"
    description={pendingShopError.message}
    actions={[
      {
        label: 'Verstanden',
        onClick: () => setPendingShopError(null),
        variant: 'primary'
      }
    ]}
    onCancel={() => setPendingShopError(null)}
  />
) : null}
{pendingShopPurchase ? (
  <PlayerDialog
    id="shop-purchase-confirm"
    title="Kaufliste kaufen?"
    role="alertdialog"
    variant="info"
    description={`${pendingShopPurchase.itemCount} Shop-Item(s) für insgesamt ${pendingShopPurchase.totalPrice} Aufgebrochene Eier kaufen?`}
    actions={[
      {
        label: isBuyingShopQueue ? 'Kaufe …' : 'Ja, kaufen',
        onClick: () => void buyQueuedShopItems(),
        disabled: isBuyingShopQueue,
        variant: 'primary'
      },
      {
        label: 'Abbrechen',
        onClick: () => setPendingShopPurchase(null),
        disabled: isBuyingShopQueue,
        variant: 'secondary'
      }
    ]}
    onCancel={() => setPendingShopPurchase(null)}
    cancelDisabled={isBuyingShopQueue}
  />
) : null}
{pendingSubscriberShopPurchase ? (
  <PlayerDialog
    id="subscriber-shop-purchase-confirm"
    title={`${pendingSubscriberShopPurchase.offer.displayName} kaufen?`}
    role="alertdialog"
    variant="info"
    description={`${pendingSubscriberShopPurchase.offer.resourcePrice} Gutschein(e) ausgeben und das Pet-Hut-Paar kaufen?`}
    actions={[
      {
        label: isBuyingSubscriberShopOffer ? 'Kaufe …' : 'Ja, kaufen',
        onClick: () =>
          void buySubscriberShopOffer(pendingSubscriberShopPurchase.offer),
        disabled: isBuyingSubscriberShopOffer,
        variant: 'primary'
      },
      {
        label: 'Abbrechen',
        onClick: () => setPendingSubscriberShopPurchase(null),
        disabled: isBuyingSubscriberShopOffer,
        variant: 'secondary'
      }
    ]}
    onCancel={() => setPendingSubscriberShopPurchase(null)}
    cancelDisabled={isBuyingSubscriberShopOffer}
  />
) : null}
{pendingEquipmentSetUpgrade ? (
  <PlayerDialog
    id="equipment-set-upgrade-confirm"
    title={`${pendingEquipmentSetUpgrade.title}?`}
    role="alertdialog"
    variant="info"
    description={`${pendingEquipmentSetUpgrade.description} Für ${pendingEquipmentSetUpgrade.cost} Aufgebrochene Eier kaufen?`}
    actions={[
      {
        label:
          upgradingInventoryKind === pendingEquipmentSetUpgrade.upgradeKind
            ? pendingEquipmentSetUpgrade.upgradeKind === 'additional-equipment-set'
              ? 'Kaufe …'
              : 'Erweitere …'
            : pendingEquipmentSetUpgrade.upgradeKind === 'additional-equipment-set'
              ? 'Ja, kaufen'
              : 'Ja, erweitern',
        onClick: () =>
          void buyEquipmentSetUpgrade(
            pendingEquipmentSetUpgrade.upgradeKind
          ),
        disabled: upgradingInventoryKind !== null,
        variant: 'primary'
      },
      {
        label: 'Abbrechen',
        onClick: () => setPendingEquipmentSetUpgrade(null),
        disabled: upgradingInventoryKind !== null,
        variant: 'secondary'
      }
    ]}
    onCancel={() => setPendingEquipmentSetUpgrade(null)}
    cancelDisabled={upgradingInventoryKind !== null}
  />
) : null}
{pendingInventoryUpgrade ? (
  <PlayerDialog
    id="inventory-upgrade-confirm"
    title={`${pendingInventoryUpgrade.title}?`}
    role="alertdialog"
    variant="info"
    description={`+1 Reihe (${formatUpgradeSlotCount(pendingInventoryUpgrade.newSlotCount)}) für ${pendingInventoryUpgrade.cost} Aufgebrochene Eier kaufen?`}
    actions={[
      {
        label:
          upgradingInventoryKind === pendingInventoryUpgrade.inventoryKind
            ? 'Erweitere …'
            : 'Ja, erweitern',
        onClick: () =>
          void upgradeInventoryRow(
            pendingInventoryUpgrade.inventoryKind
          ),
        disabled: upgradingInventoryKind !== null,
        variant: 'primary'
      },
      {
        label: 'Abbrechen',
        onClick: () => setPendingInventoryUpgrade(null),
        disabled: upgradingInventoryKind !== null,
        variant: 'secondary'
      }
    ]}
    onCancel={() => setPendingInventoryUpgrade(null)}
    cancelDisabled={upgradingInventoryKind !== null}
  />
) : null}
{statsPayload ? (
  <PlayerDialog
    id="inventory-stats"
    title={`Werte: ${getInventoryItemLabel(statsPayload)}`}
    className="stats-modal"
    actions={statsPayload.kind === 'pet' ? [
      {
        label: 'Trainieren',
        onClick: () => {
          const pet = findInventoryItem(statsPayload) as PetItem | null;
          if (pet) {
            setTrainingDialog({ target: pet, selectedIds: [] });
            setStatsPayload(null);
          }
        },
        variant: 'primary'
      },
      {
        label: 'Schließen',
        onClick: () => setStatsPayload(null),
        variant: 'secondary'
      }
    ] : [
      {
        label: 'Schließen',
        onClick: () => setStatsPayload(null),
        variant: 'primary'
      }
    ]}
    onCancel={() => setStatsPayload(null)}
  >
    {renderStatsRows(statsPayload)}
  </PlayerDialog>
) : null}
{renderTrainingDialog()}
{renamePetDraft ? (
  <PlayerDialog
    id="pet-rename"
    title="Pet umbenennen"
    onSubmit={(event) => {
      event.preventDefault();
      void confirmPetRename();
    }}
    actions={[
      {
        label: isPetRenameSubmitting
          ? 'Wird gespeichert …'
          : 'Speichern',
        type: 'submit',
        disabled: isPetRenameSubmitting,
        variant: 'primary'
      },
      {
        label: 'Abbrechen',
        onClick: () => setRenamePetDraft(null),
        disabled: isPetRenameSubmitting,
        variant: 'secondary'
      }
    ]}
    onCancel={() => setRenamePetDraft(null)}
    cancelDisabled={isPetRenameSubmitting}
  >
    <label className="rename-field">
      Neuer Spitzname
      <input
        value={renamePetDraft.nickname}
        maxLength={32}
        onChange={(event) =>
          setRenamePetDraft({
            ...renamePetDraft,
            nickname: event.target.value
          })
        }
      />
    </label>
  </PlayerDialog>
) : null}
        </>
      ) : null}
      <section
        className="player-page-shell"
        aria-label="Spielbereiche"
        onTouchStart={(event) =>
          handlePlayerPageSwipeStart(
            event.changedTouches[0]?.clientX ?? 0,
            event.changedTouches[0]?.clientY ?? 0
          )
        }
        onTouchEnd={(event) =>
          handlePlayerPageSwipeEnd(
            event.changedTouches[0]?.clientX ?? 0,
            event.changedTouches[0]?.clientY ?? 0,
            playerPages.length
          )
        }
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goToPlayerPage(currentPlayerPageIndex - 1);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            goToPlayerPage(currentPlayerPageIndex + 1);
          }
        }}
        tabIndex={0}
      >
        <button
          type="button"
          className="player-page-arrow player-page-arrow--previous"
          onClick={() => goToPlayerPage(currentPlayerPageIndex - 1)}
          disabled={currentPlayerPageIndex === 0}
          aria-label="Vorherige Seite"
        >
          ‹
        </button>
        <div className="player-page-viewport">
          <div
            className="player-page-track"
            style={{ transform: `translateX(-${currentPlayerPageIndex * 100}%)` }}
          >
            {playerPages.map((page, index) => (
              <article
                key={page.id}
                className="player-page"
                aria-hidden={index !== currentPlayerPageIndex}
                aria-label={page.label}
              >
                {page.content}
              </article>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="player-page-arrow player-page-arrow--next"
          onClick={() => goToPlayerPage(currentPlayerPageIndex + 1)}
          disabled={currentPlayerPageIndex === playerPages.length - 1}
          aria-label="Nächste Seite"
        >
          ›
        </button>
      </section>
      {!me?.authenticated ? (
        <section className="card player-login-hint">
          <p>Nach dem Login kannst du per Wischgeste zwischen Inkubator, Pets, Verbrauchbarem, Ausrüstung, Profil und Shop wechseln.</p>
        </section>
      ) : null}
      {toastMessage ? (
        <div className="toast-viewport" aria-live="polite" aria-atomic="true">
          <p
            key={toastMessage.id}
            className={`status-toast status-toast--${toastMessage.tone}`}
            role="status"
          >
            {toastMessage.text}
          </p>
        </div>
      ) : null}
      </main>
      <nav
        className="bottom-nav player-page-tabs"
        aria-label="Spielbereich wechseln"
      >
        {playerPages.map((page, index) => (
          <button
            key={page.id}
            type="button"
            className={index === currentPlayerPageIndex ? 'active' : undefined}
            onClick={() => goToPlayerPage(index)}
            aria-current={index === currentPlayerPageIndex ? 'page' : undefined}
            aria-label={page.label}
            title={page.label}
          >
            <span className="player-page-tab-icon" aria-hidden="true">
              {page.icon}
            </span>
            <span className="player-page-tab-label">{page.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
