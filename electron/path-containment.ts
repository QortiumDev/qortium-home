import path from 'node:path';

/**
 * Filesystem path containment, in one place.
 *
 * Every "is this path inside that directory" check in Home must answer the
 * same way, because each one of them is a security boundary: the Core manager
 * uses it to refuse a jar or an API key outside the install it is managing,
 * and the publish source selection uses it to refuse a symbolic link pointing
 * out of the folder the user chose.
 *
 * `path.relative()` is the check, not `startsWith(parent + sep)`. String
 * prefixing is right often enough to look correct and wrong in the cases that
 * matter: it says `/data/site-backup` is inside `/data/site` unless the caller
 * remembers the separator, it does not normalise `.` or `..` segments or a
 * trailing separator, and on Windows it treats `C:\\x` and `c:\\x` as
 * different roots. Resolving both sides and asking for the relative path
 * answers all of those the same way the filesystem would.
 */
export function normalizeFilesystemPath(value: string) {
  return path.resolve(value);
}

export function isPathWithinPath(candidatePath: string, parentPath: string) {
  const relativePath = path.relative(normalizeFilesystemPath(parentPath), normalizeFilesystemPath(candidatePath));

  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
