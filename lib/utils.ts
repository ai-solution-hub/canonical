import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns true if the user is on macOS/iOS */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return true;
  if (navigator.platform) {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  }
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}
