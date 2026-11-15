Propose an ordered plan of actions for the user to review and confirm once. It runs
nothing. An argument may reference an earlier step's result as { fromStep, field }, at
most one such reference per step. The plan stops at the first failure. Returns whether
the proposal was accepted, or the reason it was refused.
