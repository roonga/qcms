/**
 * Whether the panel shows a Confirm of its own at its foot. A waiting card taller than the
 * scrolling conversation leaves its own Confirm and Cancel below the fold, so the decision
 * is off screen however the card was revealed. A card asking for a typed confirmation pins
 * nothing: that field is inside the card, so the decision cannot be taken from the foot.
 */
export function pinsDecision(input: {
  readonly waiting: boolean;
  readonly typedConfirmation: boolean;
  readonly cardHeight: number;
  readonly viewHeight: number;
}): boolean {
  const { waiting, typedConfirmation, cardHeight, viewHeight } = input;
  if (!waiting || typedConfirmation || viewHeight <= 0 || cardHeight <= 0) return false;
  return cardHeight > viewHeight;
}
