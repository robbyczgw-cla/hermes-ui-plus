import type { ComponentType } from 'react';
import { BlobLoader, DotsLoader, OrbitLoader, PulseLoader, RingLoader, SparkleLoader, WaveLoader } from './basic';
import type { LoaderProps } from './clock';
import { BarsLoader, ChameleonLoader, GearLoader, GridLoader, MagnifierLoader, PageLoader, PencilLoader, PinLoader, ScanLoader } from './scenes';
import type { LoaderKind } from './waiting';

export const LOADERS: Record<LoaderKind, ComponentType<LoaderProps>> = {
  dots: DotsLoader,
  orbit: OrbitLoader,
  sparkle: SparkleLoader,
  wave: WaveLoader,
  ring: RingLoader,
  blob: BlobLoader,
  scan: ScanLoader,
  chameleon: ChameleonLoader,
  magnifier: MagnifierLoader,
  gear: GearLoader,
  page: PageLoader,
  pencil: PencilLoader,
  bars: BarsLoader,
  grid: GridLoader,
  pin: PinLoader,
  pulse: PulseLoader,
};

/** Width a loader occupies at `size` (the chameleon is a bit wider than tall). */
export function loaderWidth(kind: LoaderKind, size: number): number {
  return kind === 'chameleon' ? size * 1.15 : size;
}

/** Any indicator of the library by kind. Theme-coloured; `animate={false}` = static pose. */
export function Loader({ kind, size = 28, animate = true }: LoaderProps & { kind: LoaderKind }) {
  const C = LOADERS[kind] ?? PulseLoader;
  return <C size={size} animate={animate} />;
}
