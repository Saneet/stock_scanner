export function toApiTicker(symbol: string): string {
  return symbol.replace(/[.-]/g, "-");
}

export function toSheetTicker(symbol: string): string {
  return symbol.replace(/[.-]/g, ".");
}
