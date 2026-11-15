Propose an ordered plan of actions for the user to review and confirm once. A single
action is a plan of one step. It runs nothing: the user sees a card with every step and
every argument in full and confirms it on the screen's own control. An argument may
reference an earlier step's result as { fromStep, field }, at most one such reference per
step. The plan stops at the first failure. Returns whether the proposal was accepted, or
the reason it was refused.
