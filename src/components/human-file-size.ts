// One spelling of a byte count everywhere a member reads one. Kept
// React-free in its own module so the ./transcript entry can re-export
// it without dragging the attachment chips' React closure along.

export function humanFileSize(byteSize: number): string {
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (byteSize >= 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }
  return `${String(byteSize)} B`;
}
