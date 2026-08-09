import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const stubPath = join(dirname(fileURLToPath(import.meta.url)), 'stubs/react-native.mjs');

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'react-native') {
    return {
      url: pathToFileURL(stubPath).href,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}

register(import.meta.url);
