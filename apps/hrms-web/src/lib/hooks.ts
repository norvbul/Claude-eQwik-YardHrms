import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError, errorMessage, useToast } from '@yardhrms/ui';
import { useForm, type FieldValues, type Path, type UseFormProps, type UseFormReturn } from 'react-hook-form';
import type { ZodType } from 'zod';
import { api } from './api';

export function useApi<T>(key: QueryKey, path: string | null, params?: Record<string, unknown>, opts: { enabled?: boolean; keepPrevious?: boolean } = {}) {
  return useQuery<T>({
    queryKey: [...key, params ?? {}],
    queryFn: () => api.get<T>(path!, params),
    enabled: !!path && (opts.enabled ?? true),
    placeholderData: opts.keepPrevious ? (keepPreviousData as any) : undefined,
  });
}

export function usePaged<T>(key: QueryKey, path: string, params: Record<string, unknown>, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...key, params],
    queryFn: () => api.getPage<T>(path, params),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/** Mutation with toast feedback and cache invalidation. */
export function useAction<TVars = void, TResult = unknown>(fn: (v: TVars) => Promise<TResult>, opts: { success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void; silentError?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      for (const k of opts.invalidate ?? []) await qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(e instanceof ApiError && e.status === 402 ? 'Subscription limit' : 'Action failed', errorMessage(e));
    },
  });
}

/** react-hook-form + Zod (shared schemas) with server field-error mapping. */
export function useZodForm<T extends FieldValues>(schema: ZodType<any, any>, props?: UseFormProps<T>) {
  return useForm<T>({ resolver: zodResolver(schema as any) as any, mode: 'onTouched', ...props });
}

export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, e: unknown): boolean {
  if (e instanceof ApiError && e.fieldErrors && Object.keys(e.fieldErrors).length) {
    for (const [path, message] of Object.entries(e.fieldErrors)) form.setError(path as Path<T>, { message });
    return true;
  }
  return false;
}
