import { hash, verify } from '@node-rs/argon2';
// @node-rs/argon2 exposes Argon2id as a const enum; isolatedModules rejects
// const-enum imports, so use the documented numeric value.
const ARGON2ID = 2;
const argonOptions = {
    algorithm: ARGON2ID,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
    outputLen: 32,
};
export function hashPassword(password) {
    return hash(password, argonOptions);
}
export function verifyPassword(passwordHash, password) {
    return verify(passwordHash, password);
}
//# sourceMappingURL=password.js.map