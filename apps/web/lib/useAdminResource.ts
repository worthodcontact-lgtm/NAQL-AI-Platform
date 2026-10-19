"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch, buildQuery } from "./admin";

/**
 * Read-only loader for a single administrative resource.
 * Errors are surfaced to the page; session failures redirect automatically.
 */
export function useAdminResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminFetch(path)
      .then((result) => {
        if (!cancelled) setData(result as T);
      })
      .catch((caught: any) => {
        if (!cancelled) setError(caught?.message ?? "تعذّر تحميل البيانات");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, reloadKey]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  return { data, loading, error, reload };
}

export interface AdminListState<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  filters: Record<string, string>;
  loading: boolean;
  error: string | null;
  setPage: (page: number) => void;
  apply: (filters: Record<string, string>) => void;
  reload: () => void;
}

/**
 * Paginated list loader. Filters are applied explicitly (on submit), never on
 * every keystroke, so typing does not flood the API.
 */
export function useAdminList<T>(basePath: string, initialFilters: Record<string, string> = {}): AdminListState<T> {
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminFetch(`${basePath}${buildQuery({ ...filters, page, pageSize })}`)
      .then((result) => {
        if (cancelled) return;
        setItems(Array.isArray(result?.items) ? result.items : []);
        setTotal(typeof result?.total === "number" ? result.total : 0);
      })
      .catch((caught: any) => {
        if (!cancelled) setError(caught?.message ?? "تعذّر تحميل البيانات");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, filters, page, pageSize, reloadKey]);

  const apply = useCallback((next: Record<string, string>) => {
    setFilters(next);
    setPage(1);
  }, []);

  // If a filter change leaves the current page beyond the last page, move back
  // instead of showing an empty table with a valid-looking pagination control.
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [total, page, pageSize]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  return { items, total, page, pageSize, filters, loading, error, setPage, apply, reload };
}
