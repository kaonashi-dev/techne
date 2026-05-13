let warned = false;

export function warnDeprecatedBnest() {
  if (warned) return;
  warned = true;
  console.warn(
    "[bnest] @kaonashi-dev/bnest is deprecated; install and import @kaonashi-dev/techne instead.",
  );
}
