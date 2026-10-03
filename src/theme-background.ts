export type ThemeBackground = {
  type: 'solid' | 'gradient' | 'image';
  color1: string; color2: string; angle: number;
  image: string; dim: number; opacity: number;
  fit: 'cover' | 'contain' | 'repeat';
};
export const defaultBackground: ThemeBackground = {
  type: 'solid', color1: '#171a17', color2: '#394d35', angle: 135,
  image: '', dim: 35, opacity: 90, fit: 'cover',
};
export function parseBackground(value: unknown): ThemeBackground {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültiger Theme-Hintergrund.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !Object.prototype.hasOwnProperty.call(defaultBackground, key))) throw new Error('Unbekannte Hintergrund-Einstellung.');
  const b = { ...defaultBackground, ...data } as ThemeBackground;
  if (!['solid', 'gradient', 'image'].includes(b.type) || !['cover', 'contain', 'repeat'].includes(b.fit)) throw new Error('Ungültiger Hintergrundtyp.');
  for (const color of [b.color1, b.color2]) if (typeof color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) throw new Error('Ungültige Verlaufsfarbe.');
  for (const [value, max] of [[b.angle, 360], [b.dim, 100], [b.opacity, 100]]) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('Ungültiger Hintergrund-Regler.');
  if (typeof b.image !== 'string' || b.image.length > 192 * 1024 || (b.image !== '' && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.image))) throw new Error('Bitte ein gültiges Hintergrundbild auswählen.');
  return b;
}
export function wallpaper(background?: ThemeBackground): string {
  if (!background || background.type === 'solid') return 'none';
  const shade = `linear-gradient(rgb(0 0 0 / ${background.dim}%), rgb(0 0 0 / ${background.dim}%))`;
  if (background.type === 'gradient') return `${shade}, linear-gradient(${background.angle}deg, ${background.color1}, ${background.color2})`;
  return background.image ? `${shade}, url("${background.image}")` : 'none';
}
export function surfaceColor(color: string, background?: ThemeBackground): string {
  return !background || background.type === 'solid' || background.opacity === 100 ? color : `color-mix(in srgb, ${color} ${background.opacity}%, transparent)`;
}

/** Store a portable, bounded image inside the theme, not a temporary file path. */
export async function importBackgroundImage(file: File, format: 'image/webp' | 'image/jpeg' = 'image/webp'): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('Bitte PNG, JPG oder WebP bis 15 MB auswählen.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, (format === 'image/jpeg' ? 800 : 1600) / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Bild konnte nicht verarbeitet werden.');
    if (format === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (let quality = .85; quality >= .15; quality -= .1) {
      const result = canvas.toDataURL(format, quality);
      if (result.length <= 192 * 1024) return result;
    }
    throw new Error('Das Bild enthält zu viele Details. Bitte ein kleineres Bild auswählen.');
  } finally { bitmap.close(); }
}
