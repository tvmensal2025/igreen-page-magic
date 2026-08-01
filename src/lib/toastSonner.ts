/**
 * Wrapper do sonner: traduz mensagens técnicas e alonga duração de erros.
 */
import { toast as rawToast } from "sonner";
import { toUserFacingError } from "@/lib/userFacingError";

const DEFAULT_MS = 8000;
const ERROR_MS = 14000;

type ToastOpts = Parameters<typeof rawToast>[1];
type ErrorOpts = Parameters<typeof rawToast.error>[1];

function translateMaybe(value: unknown): unknown {
  if (typeof value === "string") return toUserFacingError(value, value);
  return value;
}

function withDuration(opts: ToastOpts | ErrorOpts | undefined, ms: number) {
  if (!opts || typeof opts !== "object") return { duration: ms };
  const o = opts as Record<string, unknown>;
  return {
    ...o,
    duration: typeof o.duration === "number" ? o.duration : ms,
    description:
      typeof o.description === "string"
        ? toUserFacingError(o.description, o.description)
        : o.description,
  };
}

function toast(message: Parameters<typeof rawToast>[0], opts?: ToastOpts) {
  return rawToast(translateMaybe(message) as typeof message, withDuration(opts, DEFAULT_MS) as ToastOpts);
}

toast.error = (message: Parameters<typeof rawToast.error>[0], opts?: ErrorOpts) =>
  rawToast.error(
    translateMaybe(message) as typeof message,
    withDuration(opts, ERROR_MS) as ErrorOpts,
  );

toast.success = (message: Parameters<typeof rawToast.success>[0], opts?: ErrorOpts) =>
  rawToast.success(
    translateMaybe(message) as typeof message,
    withDuration(opts, DEFAULT_MS) as ErrorOpts,
  );

toast.info = (message: Parameters<typeof rawToast.info>[0], opts?: ErrorOpts) =>
  rawToast.info(
    translateMaybe(message) as typeof message,
    withDuration(opts, DEFAULT_MS) as ErrorOpts,
  );

toast.warning = (message: Parameters<typeof rawToast.warning>[0], opts?: ErrorOpts) =>
  rawToast.warning(
    translateMaybe(message) as typeof message,
    withDuration(opts, DEFAULT_MS) as ErrorOpts,
  );

toast.message = (message: Parameters<typeof rawToast.message>[0], opts?: ErrorOpts) =>
  rawToast.message(
    translateMaybe(message) as typeof message,
    withDuration(opts, DEFAULT_MS) as ErrorOpts,
  );

/** Em testes o `sonner` pode vir mock incompleto — nunca quebrar no bind. */
function bindMethod<T extends (...args: never[]) => unknown>(fn: T | undefined): T {
  if (typeof fn === "function") return fn.bind(rawToast) as T;
  return ((() => undefined) as unknown) as T;
}

toast.promise = bindMethod(rawToast.promise);
toast.dismiss = bindMethod(rawToast.dismiss);
toast.loading = bindMethod(rawToast.loading);
toast.custom = bindMethod(rawToast.custom);

export { toast };
