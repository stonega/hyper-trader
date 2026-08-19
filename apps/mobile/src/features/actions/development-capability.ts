/**
 * Source-development testnet submission has no environment, remote, or UI
 * override. Release builds always receive a closed action runtime.
 */
export function developmentTestnetSubmissionEnabled(
  isDevelopmentBuild: boolean,
): boolean {
  return isDevelopmentBuild;
}
