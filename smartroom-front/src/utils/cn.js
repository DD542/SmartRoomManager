/**
 * Concaténation conditionnelle de classes Tailwind.
 * Accepte chaînes, tableaux et objets { classe: booleen }.
 */
export function cn(...parts) {
  const out = [];
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === 'string' || typeof part === 'number') {
      out.push(String(part));
    } else if (Array.isArray(part)) {
      const nested = cn(...part);
      if (nested) out.push(nested);
    } else if (typeof part === 'object') {
      for (const [key, value] of Object.entries(part)) {
        if (value) out.push(key);
      }
    }
  }
  return out.join(' ');
}
