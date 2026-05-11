UPDATE unhatched_eggs
SET slot_index = NULL
WHERE state <> 'ready_for_incubation'
  AND slot_index IS NOT NULL;
