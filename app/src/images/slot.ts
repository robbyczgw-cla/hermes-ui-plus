/**
 * Decision logic for image slots on cards (compare columns, product / place cards, choice options, list
 * thumbnails, guide steps). Pure: no RN imports (tested in slot.test.ts).
 *
 * Without a photo a card must not reserve a big empty box. Per slot:
 *   image     the photo (or a tap-to-load button) is there
 *   skeleton  still resolving (capped, see IMAGE_SLOT_CAP_MS)
 *   fallback  no photo, but a sibling card in the same group has / may get one → a small calm tile keeps the
 *             cards aligned (monogram or category glyph on the surface colour)
 *   collapse  no photo and nobody in the group has one → no image area at all, the card starts with its text
 */

/** A resolving slot shimmers at most this long, then it counts as "no photo". */
export const IMAGE_SLOT_CAP_MS = 3000;

export type SlotStatus = 'pending' | 'image' | 'none';
export type SlotMode = 'image' | 'skeleton' | 'fallback' | 'collapse';

/**
 * Status of one slot. `pending`: the photo may still arrive (idle while streaming, or resolving);
 * `expired`: the resolving cap passed – sticky, a late photo no longer re-opens a collapsed slot (no layout jump).
 */
export function slotStatus(s: { hasImage: boolean; pending: boolean; expired?: boolean }): SlotStatus {
  if (s.expired) return 'none';
  if (s.hasImage) return 'image';
  return s.pending ? 'pending' : 'none';
}

/** What a slot renders, given its own status and the statuses of the other slots of its group. */
export function slotMode(self: SlotStatus, peers: readonly SlotStatus[]): SlotMode {
  if (self === 'image') return 'image';
  if (self === 'pending') return 'skeleton';
  return peers.some((p) => p === 'image' || p === 'pending') ? 'fallback' : 'collapse';
}

/** Does anybody in the group occupy image space (photo or still resolving)? */
export const groupHasImages = (statuses: readonly SlotStatus[]): boolean => statuses.some((s) => s === 'image' || s === 'pending');

/**
 * Height of the fallback tile next to real photos: small thumbnails keep their size (rows stay aligned),
 * big hero areas shrink to about half (never a big empty box).
 */
export function fallbackHeight(height: number): number {
  if (!(height > 0)) return 0;
  return height <= 72 ? height : Math.max(48, Math.round(height / 2));
}

/** One or two letters for the fallback tile: "8 GB" → "8", "iPhone 15" → "I", "Café de Flore" → "C". '' when none. */
export function monogram(label: string | undefined): string {
  const m = /[\p{L}\p{N}]/u.exec((label ?? '').trim());
  return m ? m[0].toLocaleUpperCase() : '';
}

/**
 * Does the slot still need the (shared) viewport watcher? Only while it waits for its first visibility to start a
 * lookup (`loading` without a cached result) AND renders a measurable box (image / skeleton). Collapsed or
 * fallback slots, resolved / cached ones, idle (streaming) ones and those already seen unregister.
 */
export function slotNeedsVisibility(s: { enabled: boolean; seen: boolean; status: 'idle' | 'loading' | 'done'; mode: SlotMode }): boolean {
  return s.enabled && !s.seen && s.status === 'loading' && (s.mode === 'image' || s.mode === 'skeleton');
}

/**
 * Does a resolving slot show the loading shimmer (instead of its category glyph)? Products / places cards wait for
 * their first visibility report before the lookup starts (`seen`), and only that lookup is capped (`lookupCapPassed`,
 * which also turns the slot into fallback / collapse). Waiting itself is capped too (`waitCapPassed`): a slot that is
 * still not reported visible after IMAGE_SLOT_CAP_MS shows its calm category glyph – it keeps its size, so a lookup
 * started by a later scroll can still fill it without a layout jump. Never a blank shimmer tile forever
 * (E2E round 5, N2: restored product cards).
 */
export function slotShimmer(s: { loading: boolean; seen: boolean; lookupCapPassed: boolean; waitCapPassed: boolean }): boolean {
  if (!s.loading) return false;
  return s.seen ? !s.lookupCapPassed : !s.waitCapPassed;
}

/** room kept free at the top and bottom edge of an image slot for corner badges ("Preis-Leistung", selection, rank) */
export const ASK_EDGE_CLEARANCE = 36;
/** gap between the category glyph and the tap-to-load button */
export const ASK_GAP = 8;

/**
 * Tap-to-load placeholder ("Bild von <host> laden") inside an image slot: centred (never at an edge, where it was
 * clipped and covered by the badge in the detail hero), the category glyph above the button only where both fit
 * between the badge rows; thumbnails below 120 px get the icon-only button.
 */
export function askPlaceholderLayout(height: number, iconSize: number): { compact: boolean; glyph: boolean; buttonH: number } {
  const compact = height < 120;
  const buttonH = compact ? 30 : 36;
  const glyph = !compact && iconSize + ASK_GAP + buttonH <= height - 2 * ASK_EDGE_CLEARANCE;
  return { compact, glyph, buttonH };
}

/** Where a product photo is shown. */
export type ProductImageContext = 'card' | 'rank' | 'compare' | 'detail' | 'lightbox';

/**
 * Product photos in the square-ish card thumbnails (rail card, ranked row) fill their tile ('cover'): letterboxing a
 * shot that has its own backdrop left visible bars around it. Compare columns are wide and short, where cover cut tall
 * products (speaker strap and base gone, E2E round 7), so they show the whole product like the detail sheet hero and
 * the lightbox ('contain').
 */
export function productImageFit(ctx: ProductImageContext): 'cover' | 'contain' {
  return ctx === 'card' || ctx === 'rank' ? 'cover' : 'contain';
}

/** Margin of the photo inside a product tile: only a whole-product ('contain') tile gets one; a covering photo is edge to edge. */
export function photoInset(s: { tile?: boolean; fit: 'cover' | 'contain'; height: number }): number {
  return s.tile && s.fit === 'contain' ? Math.max(4, Math.round(s.height * 0.08)) : 0;
}
