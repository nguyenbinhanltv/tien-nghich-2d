/** An error carrying an HTTP-style status and a stable machine code. */
export function problem(status, code, message, head) {
  return Object.assign(new Error(message), {status, code, head});
}
