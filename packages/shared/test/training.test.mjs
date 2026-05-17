import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateLevelStatBonus,
  consumedPetTrainingValue,
  levelForTrainingPoints,
  projectTraining,
  trainingLevelCost,
  trainingProgress,
  getDuplicateTrainingMaterialBlockReason
} from '../dist/training.js';

test('level requirements use powers of two', () => {
  assert.equal(trainingLevelCost(0), 2);
  assert.equal(trainingLevelCost(1), 4);
  assert.equal(trainingLevelCost(2), 8);
  assert.equal(levelForTrainingPoints(1), 0);
  assert.equal(levelForTrainingPoints(2), 1);
  assert.equal(levelForTrainingPoints(5), 1);
  assert.equal(levelForTrainingPoints(6), 2);
});

test('consumed pet values and carry-over are integer based', () => {
  assert.equal(consumedPetTrainingValue(0), 2);
  assert.equal(consumedPetTrainingValue(1), 3);
  assert.equal(consumedPetTrainingValue(2), 4);
  assert.equal(consumedPetTrainingValue(3), 8);
  const progress = trainingProgress(3);
  assert.equal(progress.level, 1);
  assert.equal(progress.pointsIntoCurrentLevel, 1);
  assert.equal(progress.pointsRemainingForNextLevel, 3);
});

test('class stat bonuses recalculate from main and secondary stats', () => {
  assert.deepEqual(
    calculateLevelStatBonus(2, {
      mainStat: 'ATK',
      secondaryStatOne: 'SPD',
      secondaryStatTwo: 'POW'
    }),
    { HP: 0, ATK: 4, DEF: 0, SPD: 2, GAIN: 0, POW: 2 }
  );
});

test('training projection reports levels and stat changes', () => {
  const projection = projectTraining(
    0,
    [0, 1],
    { mainStat: 'DEF', secondaryStatOne: 'HP', secondaryStatTwo: 'GAIN' },
    10
  );
  assert.equal(projection.trainingPointsAfter, 5);
  assert.equal(projection.levelBefore, 0);
  assert.equal(projection.levelAfter, 1);
  assert.equal(projection.levelsGained, 1);
  assert.deepEqual(projection.statChanges, { HP: 1, ATK: 0, DEF: 2, SPD: 0, GAIN: 1, POW: 0 });
});


test('training material validation blocks wrong species, protected pets, selected pets, and self-consumption', () => {
  const target = { id: 'target', ownerUserId: 'user', speciesId: 'slime' };
  const baseMaterial = {
    id: 'mat',
    ownerUserId: 'user',
    speciesId: 'slime',
    status: 'active',
    isScrapped: false,
    isFavorite: false,
    isLocked: false,
    selectedForEvent: false,
    consumedByPetId: null
  };
  assert.equal(getDuplicateTrainingMaterialBlockReason(target, baseMaterial), null);
  assert.equal(getDuplicateTrainingMaterialBlockReason(target, { ...baseMaterial, speciesId: 'bat' }), 'species');
  assert.equal(getDuplicateTrainingMaterialBlockReason(target, { ...baseMaterial, isFavorite: true }), 'protected');
  assert.equal(getDuplicateTrainingMaterialBlockReason(target, { ...baseMaterial, isLocked: true }), 'protected');
  assert.equal(getDuplicateTrainingMaterialBlockReason(target, { ...baseMaterial, selectedForEvent: true }), 'selected_for_battle');
  assert.equal(getDuplicateTrainingMaterialBlockReason(target, { ...baseMaterial, id: 'target' }), 'self');
});
