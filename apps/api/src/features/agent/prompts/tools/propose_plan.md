Propose an ordered plan of actions for the user to review and confirm once. A single
action is a plan of one step. It runs nothing: the user sees a card with every step and
every argument in full and confirms it on the screen's own control. An argument may
reference an earlier step's result as { fromStep, field }, at most one such reference per
step. The plan stops at the first failure. Returns whether the proposal was accepted, or
the reason it was refused. The sentence you write immediately before this call is quoted
on the card as its reason and stays there after the card has run, so make it say WHY the
plan does what it does. Name neither the card nor its state anywhere in it, at its start
no less than at its end, and say nothing about what their Confirm will do: "The plan is
on a card for you to confirm.", "The card is up.", "waiting for your Confirm" and
"Nothing changes until you confirm it." all say what the card already says, and each one
is wrong the moment they confirm it. Give a plan of more than one step a title as well:
what it leaves behind, in the person's own words, which the card uses as its heading.
