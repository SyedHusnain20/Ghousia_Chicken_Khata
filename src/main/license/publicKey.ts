// Public half of the Ed25519 key pair used to sign/verify activation
// codes. This is meant to be public and committed - it can only verify a
// code was signed by whoever holds the matching private key, it cannot be
// used to create new valid codes. See license-tools/README.md for the
// private key, which must stay offline and NEVER be committed here.
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEArPK2qd4t8gF413WOnnOdlOzAho8BaqSlWRqIZ34k2/A=
-----END PUBLIC KEY-----
`;
