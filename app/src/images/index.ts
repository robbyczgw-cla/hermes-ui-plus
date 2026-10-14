/**
 * Image-by-query for hui nodes (`image.query`, `gallery.items[].query`, `…imageQuery`).
 * The model never writes image URLs; the app resolves real photos from Wikipedia / Wikimedia
 * Commons (keyless, with author + license attribution).
 *
 *   resolveImage('Kolosseum', 'de') → Promise<ResolvedImage | null>   (rejects on transient errors)
 *   useResolvedImage({ query, url, lang }, { enabled }) → { status, image }
 *
 * See resolver.ts for the request pipeline, batching, caching and rate-limit handling.
 */
export { imageResolver, resolveImage } from './instance';
export { useResolvedImage, useResolvedImages } from './useResolvedImage';
export { useItemImage } from './useItemImage';
export type { ItemImageState } from './useItemImage';
export { productImageQuery, placeImageQuery } from './itemImage';
export type { ItemImageResult } from './itemImage';
export type { ImageSource, ResolvedImageState, ResolvedImageStatus } from './useResolvedImage';
export type { ResolvedImage, ImageAttribution } from './types';
export { attributionText, attributionUrl } from './attribution';
export { setImageLoadPolicy, getImageLoadPolicy, imagesAllowed, useImagesAllowed } from './policy';
export type { ImageLoadPolicy } from './policy';
export { webImageSearch, setWebImageBridge, setImageSearchMode, setOwnImageConfig, ownImageSearch, bridgeConnFromProfiles, useWebImagesEnabled, imageSourceFor, useImageProxyKey } from './web';
export { useImageGate, imageLoadDecision, isTrustedImageUrl, markTrustedImageUrl, setTrustedImageOrigins, setUnknownImagePolicy, unlockImageUrl, imageHost, UNKNOWN_IMAGE_POLICIES } from './trust';
export type { UnknownImagePolicy } from './trust';
