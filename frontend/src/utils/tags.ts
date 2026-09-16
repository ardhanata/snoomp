/**
 * Utility functions for tag normalization, comparison, and merging.
 * Ensures tag handling across Snoomp is strictly case-insensitive.
 */

/**
 * Normalizes a single tag: trims whitespace and converts to lowercase.
 */
export const normalizeTag = (tag: string): string => {
  return (tag || '').trim().toLowerCase();
};

/**
 * Normalizes an array or comma-separated list of tags:
 * - Trims whitespace
 * - Converts to lowercase
 * - Strips empty tags
 * - Deduplicates case-insensitively while preserving first-seen order
 */
export const normalizeTags = (tags: any): string[] => {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : [tags];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      for (const part of item.split(',')) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          out.push(trimmed);
        }
      }
    }
  }
  return out;
};

/**
 * Checks if two tags are equal case-insensitively.
 */
export const tagEquals = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

/**
 * Checks if a list of tags contains a target tag case-insensitively.
 */
export const tagIncludes = (tags: (string | any)[] | undefined | null, targetTag: string): boolean => {
  if (!tags || !Array.isArray(tags)) return false;
  const target = (targetTag || '').trim().toLowerCase();
  if (!target) return false;
  return tags.some(t => typeof t === 'string' && t.trim().toLowerCase() === target);
};

/**
 * Merges multiple tag lists case-insensitively without duplicate entries.
 */
export const mergeTags = (
  existingTags: (string | any)[] | undefined | null,
  newTags: (string | any)[] | undefined | null
): string[] => {
  return normalizeTags([...(existingTags || []), ...(newTags || [])]);
};

/**
 * Removes tags case-insensitively from a tag list.
 */
export const removeTags = (
  tags: (string | any)[] | undefined | null,
  tagsToRemove: (string | any)[] | undefined | null
): string[] => {
  const toRemove = new Set(normalizeTags(tagsToRemove));
  return normalizeTags(tags).filter(t => !toRemove.has(t));
};
