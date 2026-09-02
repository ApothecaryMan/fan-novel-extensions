#!/usr/bin/env node
// ==========================================
// Generate an Ed25519 keypair for signing the extension index.
// Run ONCE:  npm run generate-keys
//
// Output:
//   keys/private.key   ← NEVER commit this. Add to .gitignore / GitHub Secrets.
//   keys/public.key    ← Embed in the mobile app (app.json extra.extensionsPublicKey).
// ==========================================

import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir = join(__dirname, '..', 'keys');

mkdirSync(keysDir, { recursive: true });

const privateKey = randomBytes(32);
const publicKey = ed25519.getPublicKey(privateKey);

const privHex = Buffer.from(privateKey).toString('hex');
const pubHex = Buffer.from(publicKey).toString('hex');

writeFileSync(join(keysDir, 'private.key'), privHex + '\n');
writeFileSync(join(keysDir, 'public.key'), pubHex + '\n');

console.log('✅ Keys generated in keys/');
console.log('');
console.log('🔑 Public key (embed in app.json → extra.extensionsPublicKey):');
console.log(`   ${pubHex}`);
console.log('');
console.log('🔒 Private key (add to GitHub Secrets as EXTENSION_SIGNING_KEY):');
console.log(`   ${privHex}`);
console.log('');
console.log('⚠️  NEVER commit keys/private.key — add "keys/" to .gitignore');
