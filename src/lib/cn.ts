import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Склейка классов с разрешением конфликтов Tailwind.
 *
 * - `clsx` разворачивает вложенные массивы, выкидывает falsy, склеивает пробелами.
 * - `twMerge` потом схлопывает конкурирующие Tailwind-классы, побеждает
 *   последний (например `cn("p-2", isActive && "p-4")` даёт `"p-4"`).
 *
 * Используем везде вместо ручной склейки строк.
 *
 * @example
 *   cn("text-sm", isActive && "font-bold", maybeMore)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
