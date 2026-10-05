-- One rep target per exercise: ranges collapse to their top (the old "add weight" point).
UPDATE routine_items SET rep_min = rep_max WHERE rep_min != rep_max;
