'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { UrlFilterConfig, UrlFilterReturn } from './types';

/**
 * Generic URL-synced filter state hook.
 *
 * Handles reading from and writing to URL search params via Next.js router.
 * Parameterised by filter shape T and a config that maps filter keys to
 * param names, default values, and custom parsers/serialisers.
 */
export function useUrlFilters<T extends Record<string, unknown>>(
  config: UrlFilterConfig<T>,
): UrlFilterReturn<T> {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { paramMap, defaults, parsers } = config;

  // Build filter object from URL params
  const filters = useMemo(() => {
    const result: Record<string, unknown> = {};
    const defaultValues: Partial<T> = defaults ?? ({} as Partial<T>);
    const keys = Object.keys(defaultValues) as Array<keyof T>;

    for (const key of keys) {
      const paramName =
        (paramMap?.[key] as string | undefined) ?? (key as string);
      const raw = searchParams.get(paramName);
      const parser = parsers?.[key];

      if (raw !== null && parser) {
        result[key as string] = parser(raw);
      } else if (raw !== null) {
        result[key as string] = raw;
      } else {
        result[key as string] = defaultValues[key];
      }
    }

    return result as T;
  }, [searchParams, paramMap, defaults, parsers]);

  // Count active filters (non-default, truthy values)
  const activeCount = useMemo(() => {
    const defaultValues: Partial<T> = defaults ?? ({} as Partial<T>);
    let count = 0;

    for (const key of Object.keys(defaultValues) as Array<keyof T>) {
      const value = filters[key];
      const defaultVal = defaultValues[key];

      // Skip if matches default
      if (value === defaultVal) continue;
      if (value === undefined || value === null) continue;

      // Arrays: count if non-empty
      if (Array.isArray(value)) {
        if (value.length > 0) count++;
      } else if (typeof value === 'boolean') {
        // Booleans: count only if true and default is not true
        if (value && defaultVal !== true) count++;
      } else if (typeof value === 'string') {
        if (value) count++;
      } else {
        count++;
      }
    }

    return count;
  }, [filters, defaults]);

  const setFilters = useCallback(
    (updates: Partial<T>) => {
      const params = new URLSearchParams(searchParams.toString());
      const serialisers = config.serialisers;

      for (const [key, value] of Object.entries(updates)) {
        const paramName =
          (paramMap?.[key as keyof T] as string | undefined) ?? key;
        const serialiser = serialisers?.[key as keyof T];

        if (serialiser) {
          const serialised = serialiser(value);
          if (serialised !== undefined && serialised !== '') {
            params.set(paramName, serialised);
          } else {
            params.delete(paramName);
          }
        } else if (value !== undefined && value !== null && value !== '') {
          params.set(paramName, String(value));
        } else {
          params.delete(paramName);
        }
      }

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, paramMap, config.serialisers],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return {
    filters,
    setFilters,
    clearFilters,
    activeCount,
  };
}
