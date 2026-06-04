export const DEFAULT_TRAINING_MAX_LEVEL = 10;
export const TRAINING_POINTS_PER_DUPLICATE_UNIT = 2;

export const PET_STAT_IDS = ['HP', 'ATK', 'DEF', 'SPD', 'GAIN', 'POW'] as const;
export const HP_STAT_POINT_VALUE = 10;
export type PetStatId = (typeof PET_STAT_IDS)[number];

export type PetStats = Record<PetStatId, number>;

export type PetTrainingClassStats = {
  mainStat: PetStatId;
  secondaryStatOne: PetStatId;
  secondaryStatTwo: PetStatId;
};

export type TrainingProgress = {
  level: number;
  trainingPoints: number;
  maxLevel: number;
  pointsSpentForCurrentLevel: number;
  pointsIntoCurrentLevel: number;
  pointsRequiredForNextLevel: number | null;
  pointsRemainingForNextLevel: number | null;
};

export type TrainingProjection = {
  levelBefore: number;
  levelAfter: number;
  levelsGained: number;
  trainingPointsBefore: number;
  trainingPointsAfter: number;
  statBonusBefore: PetStats;
  statBonusAfter: PetStats;
  statChanges: PetStats;
  progressAfter: TrainingProgress;
};

export function trainingLevelCost(level: number): number {
  if (!Number.isInteger(level) || level < 0) {
    throw new Error('level must be a non-negative integer');
  }
  return 2 ** (level + 1);
}

export function consumedPetTrainingValue(level: number): number {
  if (!Number.isInteger(level) || level < 0) {
    throw new Error('level must be a non-negative integer');
  }
  if (level === 0) return 2;
  if (level === 1) return 3;
  return 2 ** level;
}

export function pointsRequiredForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0) {
    throw new Error('level must be a non-negative integer');
  }
  let total = 0;
  for (let currentLevel = 0; currentLevel < level; currentLevel += 1) {
    total += trainingLevelCost(currentLevel);
  }
  return total;
}

export function levelForTrainingPoints(
  trainingPoints: number,
  maxLevel = DEFAULT_TRAINING_MAX_LEVEL
): number {
  if (!Number.isInteger(trainingPoints) || trainingPoints < 0) {
    throw new Error('trainingPoints must be a non-negative integer');
  }
  if (!Number.isInteger(maxLevel) || maxLevel < 0) {
    throw new Error('maxLevel must be a non-negative integer');
  }

  let level = 0;
  let spent = 0;
  while (level < maxLevel) {
    const nextCost = trainingLevelCost(level);
    if (trainingPoints < spent + nextCost) break;
    spent += nextCost;
    level += 1;
  }
  return level;
}

export function trainingProgress(
  trainingPoints: number,
  maxLevel = DEFAULT_TRAINING_MAX_LEVEL
): TrainingProgress {
  const level = levelForTrainingPoints(trainingPoints, maxLevel);
  const pointsSpentForCurrentLevel = pointsRequiredForLevel(level);
  const nextCost = level >= maxLevel ? null : trainingLevelCost(level);
  const pointsIntoCurrentLevel = Math.max(0, trainingPoints - pointsSpentForCurrentLevel);
  return {
    level,
    trainingPoints,
    maxLevel,
    pointsSpentForCurrentLevel,
    pointsIntoCurrentLevel,
    pointsRequiredForNextLevel: nextCost,
    pointsRemainingForNextLevel: nextCost === null ? null : Math.max(0, nextCost - pointsIntoCurrentLevel)
  };
}

export function emptyPetStats(): PetStats {
  return { HP: 0, ATK: 0, DEF: 0, SPD: 0, GAIN: 0, POW: 0 };
}

export function petStatPointValue(stat: PetStatId): number {
  return stat === 'HP' ? HP_STAT_POINT_VALUE : 1;
}

export function applyPetStatPointBonus(
  stats: PetStats,
  stat: PetStatId,
  points: number
): void {
  stats[stat] += points * petStatPointValue(stat);
}

export function calculateLevelStatBonus(
  level: number,
  classStats: PetTrainingClassStats
): PetStats {
  const bonus = emptyPetStats();
  if (level <= 0) return bonus;
  applyPetStatPointBonus(bonus, classStats.mainStat, level * 2);
  applyPetStatPointBonus(bonus, classStats.secondaryStatOne, level);
  applyPetStatPointBonus(bonus, classStats.secondaryStatTwo, level);
  return bonus;
}

export function addPetStats(left: PetStats, right: PetStats): PetStats {
  return {
    HP: left.HP + right.HP,
    ATK: left.ATK + right.ATK,
    DEF: left.DEF + right.DEF,
    SPD: left.SPD + right.SPD,
    GAIN: left.GAIN + right.GAIN,
    POW: left.POW + right.POW
  };
}

export function diffPetStats(before: PetStats, after: PetStats): PetStats {
  return {
    HP: after.HP - before.HP,
    ATK: after.ATK - before.ATK,
    DEF: after.DEF - before.DEF,
    SPD: after.SPD - before.SPD,
    GAIN: after.GAIN - before.GAIN,
    POW: after.POW - before.POW
  };
}

export function projectTraining(
  trainingPointsBefore: number,
  consumedPetLevels: number[],
  classStats: PetTrainingClassStats,
  maxLevel = DEFAULT_TRAINING_MAX_LEVEL
): TrainingProjection {
  const awarded = consumedPetLevels.reduce(
    (sum, level) => sum + consumedPetTrainingValue(level),
    0
  );
  const trainingPointsAfter = trainingPointsBefore + awarded;
  const levelBefore = levelForTrainingPoints(trainingPointsBefore, maxLevel);
  const levelAfter = levelForTrainingPoints(trainingPointsAfter, maxLevel);
  const statBonusBefore = calculateLevelStatBonus(levelBefore, classStats);
  const statBonusAfter = calculateLevelStatBonus(levelAfter, classStats);
  return {
    levelBefore,
    levelAfter,
    levelsGained: levelAfter - levelBefore,
    trainingPointsBefore,
    trainingPointsAfter,
    statBonusBefore,
    statBonusAfter,
    statChanges: diffPetStats(statBonusBefore, statBonusAfter),
    progressAfter: trainingProgress(trainingPointsAfter, maxLevel)
  };
}

export type TrainingMaterialSnapshot = {
  id: string;
  ownerUserId: string;
  speciesId: string;
  status: string;
  isScrapped: boolean;
  isFavorite: boolean;
  isLocked: boolean;
  selectedForEvent: boolean;
  consumedByPetId: string | null;
  unresolvedBattle?: boolean;
};

export function getDuplicateTrainingMaterialBlockReason(
  target: Pick<TrainingMaterialSnapshot, 'id' | 'ownerUserId' | 'speciesId'>,
  material: TrainingMaterialSnapshot
): string | null {
  if (material.id === target.id) return 'self';
  if (material.ownerUserId !== target.ownerUserId) return 'owner';
  if (material.speciesId !== target.speciesId) return 'species';
  if (material.isScrapped || material.status !== 'active' || material.consumedByPetId !== null) {
    return 'inactive';
  }
  if (material.isFavorite || material.isLocked) return 'protected';
  if (material.selectedForEvent) return 'selected_for_battle';
  if (material.unresolvedBattle) return 'unresolved_battle';
  return null;
}
