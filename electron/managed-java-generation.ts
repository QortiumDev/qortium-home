export type ManagedJavaGenerationIdentity = Readonly<{
  digest: string
  installedAt: string
  installPath: string
  javaPath: string
}>

export function sameManagedJavaGeneration(
  left: ManagedJavaGenerationIdentity | null,
  right: ManagedJavaGenerationIdentity | null,
) {
  return !!left && !!right &&
    left.digest === right.digest &&
    left.installedAt === right.installedAt &&
    left.installPath === right.installPath &&
    left.javaPath === right.javaPath
}
