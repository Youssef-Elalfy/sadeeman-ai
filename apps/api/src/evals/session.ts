// Evaluation-only classification. Expected sign-out denials must not halt
// cleanup, while unrelated forbidden responses and server failures still stop.
export function expectedSignedOutDenial(
  stage: string,
  route: string,
  status: number,
): boolean {
  return (
    ((stage === "auth_signout_removes_session_and_rejects_unexpired_jwt" &&
      ["/auth/v1/user", "/rest/v1/rpc/sadeeman_session_active"].includes(
        route,
      )) ||
      (stage === "cleanup_second_auth_session" &&
        route === "/auth/v1/logout")) &&
    (status === 401 || status === 403)
  );
}
export function classifyAuthCleanup(
  status: number,
): "CONFIRMED_SIGNOUT" | "DENIED_UNCONFIRMED" | "UNEXPECTED" {
  return status === 204
    ? "CONFIRMED_SIGNOUT"
    : status === 401 || status === 403
      ? "DENIED_UNCONFIRMED"
      : "UNEXPECTED";
}
