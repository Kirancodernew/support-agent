import bcrypt from 'bcryptjs';

// Cost 12 ≈ 250 ms per hash: unnoticeable at login, very slow for someone guessing passwords offline.
const COST = 12;

export const hashPassword = (password: string) => bcrypt.hash(password, COST);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

// Compared against when the email doesn't exist, so a login takes the same time either way
// and response timing can't reveal which emails have accounts.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);
