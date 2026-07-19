export type GalleryNavigationDirection = 'next' | 'previous';

export function getAdjacentGalleryFile(
  files: readonly string[],
  currentFile: string,
  direction: GalleryNavigationDirection,
): string | null {
  const currentIndex = files.indexOf(currentFile);
  if (currentIndex < 0) return null;

  const targetIndex = currentIndex + (direction === 'next' ? 1 : -1);
  return files[targetIndex] ?? null;
}

export function getGallerySwipeDirection(
  deltaX: number,
  deltaY: number,
  minimumDistance = 48,
): GalleryNavigationDirection | null {
  if (Math.abs(deltaX) < minimumDistance || Math.abs(deltaX) <= Math.abs(deltaY)) return null;
  return deltaX < 0 ? 'next' : 'previous';
}
