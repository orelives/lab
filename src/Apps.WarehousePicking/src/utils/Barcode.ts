export function eanError(value: string): string | undefined {
  const barcode = value.trim();
  if (!barcode) return undefined;
  return /^(?:\d{8}|\d{12,14})$/.test(barcode)
    ? undefined
    : "Enter an 8, 12, 13, or 14 digit barcode.";
}
